import { useIntl } from 'react-intl'
import Image from '@/lib/Image'
import {
  getBusinessInitials,
  pickBusinessMarkColor,
} from '@/lib/business-mark'

const ChevronRight = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
)

interface BusinessRowData {
  id: string
  name: string
  memberCount: number
  icon?: string | null
}

interface BusinessRowProps {
  business: BusinessRowData
  onClick?: () => void
  className?: string
}

export function BusinessRow({ business, onClick, className }: BusinessRowProps) {
  const intl = useIntl()

  const cls = ['business-row', className].filter(Boolean).join(' ')

  return (
    <button type="button" className={cls} onClick={onClick} data-haptic>
      <span
        className="business-row__mark"
        style={{ background: pickBusinessMarkColor(business.id) }}
      >
        {business.icon && business.icon.startsWith('data:') ? (
          <Image
            src={business.icon}
            alt=""
            width={44}
            height={44}
            className="business-row__mark-img"
            unoptimized
          />
        ) : business.icon ? (
          <span className="business-row__mark-emoji">{business.icon}</span>
        ) : (
          <span className="business-row__mark-initials">
            {getBusinessInitials(business.name)}
          </span>
        )}
      </span>
      <span className="business-row__body">
        <span className="business-row__name">{business.name}</span>
        <span className="business-row__meta">
          <span>
            {intl.formatMessage(
              { id: 'hub.member_count' },
              { count: business.memberCount }
            )}
          </span>
        </span>
      </span>
      <span className="business-row__chev">{ChevronRight}</span>
    </button>
  )
}
