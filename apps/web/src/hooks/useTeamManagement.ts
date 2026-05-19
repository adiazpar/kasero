'use client'

import { useIntl } from 'react-intl';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useBusiness } from '@/contexts/business-context'
import { apiRequest, apiPost, ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import {
  getInviteCodeExpiration,
  type InviteDuration,
} from '@kasero/shared/auth'
import { generateInviteQRCode } from '@/lib/qr'
import { canManageBusiness } from '@kasero/shared/business-role'
import type { User, InviteCode, InviteRole, UserRole } from '@kasero/shared/types'

// Team member includes role and status from business_users table.
// email is optional: the GET /team route strips it for employee callers.
export interface TeamMember extends Omit<User, 'email'> {
  email?: string
  role: UserRole
  status: 'active' | 'pending' | 'disabled'
  createdAt: Date | string
}

interface UseTeamManagementOptions {
  businessId: string
}

interface UseTeamManagementReturn {
  // Data
  teamMembers: TeamMember[]
  sortedTeamMembers: TeamMember[]
  inviteCodes: InviteCode[]
  isLoading: boolean
  error: string

  // Permission
  canManageTeam: boolean
  callerRole: UserRole | null

  // Invite code state
  selectedRole: InviteRole
  setSelectedRole: (role: InviteRole) => void
  selectedDuration: InviteDuration
  setSelectedDuration: (duration: InviteDuration) => void
  newCode: string | null
  newCodeExpiresAt: Date | null
  generatedCodeId: string | null
  qrDataUrl: string | null
  isGenerating: boolean
  copyFeedback: string | null

  // Invite code actions
  handleGenerateCode: () => Promise<void>
  handleRegenerateCode: () => Promise<void>
  handleCopyCode: (code: string) => Promise<void>
  handleDeleteCode: () => Promise<boolean>
  isDeletingCode: boolean
  codeDeleted: boolean

  // Invite modal state
  isModalOpen: boolean
  handleOpenModal: () => void
  handleOpenExistingCode: (code: InviteCode) => Promise<void>
  handleCloseModal: () => void
  handleModalExitComplete: () => void

  // User management state
  selectedMember: TeamMember | null
  isUserModalOpen: boolean
  newRole: 'partner' | 'employee'
  setNewRole: (role: 'partner' | 'employee') => void
  roleChangeLoading: boolean
  removeLoading: boolean

  // User management actions
  handleOpenUserModal: (member: TeamMember) => void
  handleCloseUserModal: () => void
  handleUserModalExitComplete: () => void
  handleToggleUserStatus: () => Promise<void>
  handleSubmitRoleChange: () => Promise<boolean>
  handleRemoveMember: () => Promise<boolean>

  // Realtime
  refresh: () => Promise<void>
}

interface TeamDataResponse {
  success?: boolean
  teamMembers?: TeamMember[]
  inviteCodes?: InviteCode[]
  error?: string
  [key: string]: unknown
}

interface InviteCodeResponse {
  success?: boolean
  id: string
  // Server-generated invite code (audit M-18). The client used to
  // send the code in the request and re-use the local value; now
  // the server returns the canonical value here.
  code: string
  error?: string
  [key: string]: unknown
}

interface ApiSuccessResponse {
  success?: boolean
  error?: string
  [key: string]: unknown
}

export function useTeamManagement({ businessId }: UseTeamManagementOptions): UseTeamManagementReturn {
  const { user } = useAuth()
  const { role } = useBusiness()
  const t = useIntl()
  const translateApiMessage = useApiMessage()

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedRole, setSelectedRole] = useState<InviteRole>('employee')
  const [selectedDuration, setSelectedDuration] = useState<InviteDuration>('24h')
  const [newCode, setNewCode] = useState<string | null>(null)
  const [newCodeExpiresAt, setNewCodeExpiresAt] = useState<Date | null>(null)
  const [generatedCodeId, setGeneratedCodeId] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Code delete state
  const [isDeletingCode, setIsDeletingCode] = useState(false)
  const [codeDeleted, setCodeDeleted] = useState(false)

  // User management modal state
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)

  // Role change state
  const [newRole, setNewRole] = useState<'partner' | 'employee'>('employee')
  const [roleChangeLoading, setRoleChangeLoading] = useState(false)
  const [removeLoading, setRemoveLoading] = useState(false)

  // Managers (owner + partner) can perform team operations. Server-side
  // routes additionally enforce a partner-on-partner guard for change-role
  // and toggle-status, which the UI mirrors via callerRole + member.role.
  const canManageTeam = canManageBusiness(role)

  // Load team members and invite codes
  const loadTeamData = useCallback(async () => {
    try {
      const data = await apiRequest<TeamDataResponse>(`/api/businesses/${businessId}/team`)
      setTeamMembers(data.teamMembers || [])
      setInviteCodes(data.inviteCodes || [])
    } catch (err) {
      console.error('Error loading team data:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({
          id: 'team.error_failed_to_load'
        })
      )
    } finally {
      setIsLoading(false)
    }
  }, [businessId, t, translateApiMessage])

  useEffect(() => {
    loadTeamData()
  }, [loadTeamData])

  useEffect(() => {
    const unsubTeam = registerRefetch('team', loadTeamData)
    const unsubInvites = registerRefetch('invites', loadTeamData)
    return () => {
      unsubTeam()
      unsubInvites()
    }
  }, [loadTeamData])

  // Sort team members: owner first, then partners, then employees
  const sortedTeamMembers = useMemo(() => {
    const roleOrder: Record<string, number> = {
      owner: 0,
      partner: 1,
      employee: 2,
    }
    return [...teamMembers].sort((a, b) => {
      const orderA = roleOrder[a.role] ?? 99
      const orderB = roleOrder[b.role] ?? 99
      return orderA - orderB
    })
  }, [teamMembers])

  const handleGenerateCode = useCallback(async () => {
    if (!user) return

    setIsGenerating(true)
    setError('')
    setNewCode(null)
    setNewCodeExpiresAt(null)

    try {
      const expiresAt = getInviteCodeExpiration(selectedDuration)

      // Server generates the code now (audit M-18). The client used
      // to pick the value, which let a malicious manager choose a
      // memorable string and shrink the brute-force keyspace.
      const data = await apiPost<InviteCodeResponse>(
        `/api/businesses/${businessId}/invite/create`,
        {
          role: selectedRole,
          expiresAt: expiresAt.toISOString(),
        }
      )

      setGeneratedCodeId(data.id)
      setNewCode(data.code)
      setNewCodeExpiresAt(expiresAt)

      // Generate QR code
      const qr = await generateInviteQRCode(data.code)
      setQrDataUrl(qr)

      // Add new code to the list
      const newInviteCode: InviteCode = {
        id: data.id,
        code: data.code,
        role: selectedRole,
        createdBy: user.id,
        expiresAt: expiresAt.toISOString(),
      }
      setInviteCodes(prev => [...prev, newInviteCode])
    } catch (err) {
      console.error('Error generating invite code:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({
          id: 'team.error_failed_to_generate_code'
        })
      )
    } finally {
      setIsGenerating(false)
    }
  }, [user, selectedRole, selectedDuration, businessId, t, translateApiMessage])

  const handleCopyCode = useCallback(async (code: string) => {
    try {
      // Check if clipboard API is available (requires secure context - HTTPS)
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(code)
      } else {
        // Fallback for non-secure contexts (HTTP on mobile)
        const textArea = document.createElement('textarea')
        textArea.value = code
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        textArea.style.top = '-9999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      // Clear any existing timer before setting a new one
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current)
      }
      setCopyFeedback(code)
      copyFeedbackTimerRef.current = setTimeout(() => setCopyFeedback(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      // Show the code in an alert as last resort
      alert(t.formatMessage({
        id: 'team.copy_fallback_alert'
      }, { code }))
    }
  }, [t])

  const handleRegenerateCode = useCallback(async () => {
    if (!user || !generatedCodeId) return

    setIsGenerating(true)

    try {
      // Server generates the new code and returns it; the client no
      // longer picks the value (audit M-18).
      const expiresAt = getInviteCodeExpiration(selectedDuration)

      const data = await apiPost<InviteCodeResponse>(
        `/api/businesses/${businessId}/invite/regenerate`,
        {
          oldCodeId: generatedCodeId,
          role: selectedRole,
          expiresAt: expiresAt.toISOString(),
        }
      )

      const oldCodeId = generatedCodeId
      setGeneratedCodeId(data.id)
      setNewCode(data.code)
      setNewCodeExpiresAt(expiresAt)

      // Generate new QR
      const qr = await generateInviteQRCode(data.code)
      setQrDataUrl(qr)

      // Update invite codes list: remove old, add new
      const newInviteCode: InviteCode = {
        id: data.id,
        code: data.code,
        role: selectedRole,
        createdBy: user.id,
        expiresAt: expiresAt.toISOString(),
      }
      setInviteCodes(prev => [...prev.filter(c => c.id !== oldCodeId), newInviteCode])
    } catch (err) {
      console.error('Error regenerating code:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({
          id: 'team.error_failed_to_regenerate_code'
        })
      )
    } finally {
      setIsGenerating(false)
    }
  }, [user, generatedCodeId, selectedRole, selectedDuration, businessId, t, translateApiMessage])

  const handleDeleteCode = useCallback(async (): Promise<boolean> => {
    if (!generatedCodeId) return false

    setIsDeletingCode(true)

    try {
      await apiPost<ApiSuccessResponse>(
        `/api/businesses/${businessId}/invite/delete`,
        { id: generatedCodeId }
      )

      setInviteCodes(prev => prev.filter(c => c.id !== generatedCodeId))
      setCodeDeleted(true)
      return true
    } catch (err) {
      console.error('Error deleting code:', err)
      return false
    } finally {
      setIsDeletingCode(false)
    }
  }, [generatedCodeId, businessId])

  const handleOpenModal = useCallback(() => {
    // Close user modal if open (mutual exclusivity)
    setIsUserModalOpen(false)
    // Reset and open add member modal
    setNewCode(null)
    setNewCodeExpiresAt(null)
    setGeneratedCodeId(null)
    setQrDataUrl(null)
    setSelectedRole('employee')
    setSelectedDuration('24h')
    setError('')
    setIsModalOpen(true)
  }, [])

  const handleOpenExistingCode = useCallback(async (code: InviteCode) => {
    // Close user modal if open (mutual exclusivity)
    setIsUserModalOpen(false)
    // Open existing code modal
    setSelectedRole(code.role)
    setGeneratedCodeId(code.id)
    setNewCode(code.code)
    setNewCodeExpiresAt(new Date(code.expiresAt))
    setError('')
    setIsModalOpen(true)

    // Generate QR code for existing invite
    try {
      const qr = await generateInviteQRCode(code.code)
      setQrDataUrl(qr)
    } catch (err) {
      console.error('Failed to generate QR code:', err)
    }
  }, [])

  const handleCloseModal = useCallback(() => {
    // Only close the modal - state cleanup happens in onExitComplete
    setIsModalOpen(false)
  }, [])

  // Called after modal close animation completes
  const handleModalExitComplete = useCallback(() => {
    setNewCode(null)
    setNewCodeExpiresAt(null)
    setGeneratedCodeId(null)
    setQrDataUrl(null)
    setError('')
    setSelectedRole('employee')
    setSelectedDuration('24h')
    setCodeDeleted(false)
    // Clear copy feedback timer and state
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = null
    }
    setCopyFeedback(null)
  }, [])

  // User management modal handlers
  const handleOpenUserModal = useCallback((member: TeamMember) => {
    // Close add member modal if open (mutual exclusivity)
    setIsModalOpen(false)
    // Open user modal
    setSelectedMember(member)
    setIsUserModalOpen(true)
    // Reset form state when opening
    setNewRole(member.role === 'partner' ? 'partner' : 'employee')
  }, [])

  const handleCloseUserModal = useCallback(() => {
    // Only close the modal - state cleanup happens in onExitComplete
    setIsUserModalOpen(false)
  }, [])

  // Called after user modal close animation completes
  const handleUserModalExitComplete = useCallback(() => {
    setSelectedMember(null)
  }, [])

  const handleToggleUserStatus = useCallback(async () => {
    if (!selectedMember) return
    const newStatus = selectedMember.status === 'active' ? 'disabled' : 'active'
    try {
      await apiPost<ApiSuccessResponse>(
        `/api/businesses/${businessId}/users/toggle-status`,
        { userId: selectedMember.id, status: newStatus }
      )

      const updatedMember = { ...selectedMember, status: newStatus as TeamMember['status'] }
      setSelectedMember(updatedMember)
      setTeamMembers(prev =>
        prev.map(m => m.id === selectedMember.id ? updatedMember : m)
      )
    } catch (err) {
      console.error('Error updating user status:', err)
    }
  }, [selectedMember, businessId])

  const handleSubmitRoleChange = useCallback(async (): Promise<boolean> => {
    if (!selectedMember) return false

    setRoleChangeLoading(true)

    try {
      await apiPost<ApiSuccessResponse>(
        `/api/businesses/${businessId}/users/change-role`,
        { userId: selectedMember.id, role: newRole }
      )

      // Update local state
      const updatedMember = { ...selectedMember, role: newRole }
      setSelectedMember(updatedMember)
      setTeamMembers(prev =>
        prev.map(m => m.id === selectedMember.id ? updatedMember : m)
      )

      return true
    } catch (err) {
      console.error('Error changing role:', err)
      return false
    } finally {
      setRoleChangeLoading(false)
    }
  }, [selectedMember, newRole, businessId])

  const handleRemoveMember = useCallback(async (): Promise<boolean> => {
    if (!selectedMember) return false

    setRemoveLoading(true)
    try {
      await apiPost<ApiSuccessResponse>(
        `/api/businesses/${businessId}/users/remove`,
        { userId: selectedMember.id },
      )
      setTeamMembers(prev => prev.filter(m => m.id !== selectedMember.id))
      return true
    } catch (err) {
      console.error('Error removing member:', err)
      return false
    } finally {
      setRemoveLoading(false)
    }
  }, [selectedMember, businessId])

  return {
    // Data
    teamMembers,
    sortedTeamMembers,
    inviteCodes,
    isLoading,
    error,

    // Permission
    canManageTeam,
    callerRole: role,

    // Invite code state
    selectedRole,
    setSelectedRole,
    selectedDuration,
    setSelectedDuration,
    newCode,
    newCodeExpiresAt,
    generatedCodeId,
    qrDataUrl,
    isGenerating,
    copyFeedback,

    // Invite code actions
    handleGenerateCode,
    handleRegenerateCode,
    handleCopyCode,
    handleDeleteCode,
    isDeletingCode,
    codeDeleted,

    // Invite modal state
    isModalOpen,
    handleOpenModal,
    handleOpenExistingCode,
    handleCloseModal,
    handleModalExitComplete,

    // User management state
    selectedMember,
    isUserModalOpen,
    newRole,
    setNewRole,
    roleChangeLoading,
    removeLoading,

    // User management actions
    handleOpenUserModal,
    handleCloseUserModal,
    handleUserModalExitComplete,
    handleToggleUserStatus,
    handleSubmitRoleChange,
    handleRemoveMember,

    // Realtime
    refresh: loadTeamData,
  }
}
