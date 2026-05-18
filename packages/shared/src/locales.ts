/**
 * Locale registry — single source of truth for adding a new language.
 *
 * To add a language:
 *   1. Add an entry to LOCALES with label, acceptPrefixes, and translate
 *      metadata (name + guidance).
 *   2. Copy `en-US.json` → `<code>.json` in src/i18n/messages/.
 *   3. Run `npm run i18n:translate -- --target <code>`.
 *
 * Everything else (the supported-locale list consumed by the react-intl
 * provider, the Accept-Language picker's prefix matching, the
 * business-locale → translation-file resolver, the language-row label,
 * and the translate script's system prompt) derives from this object.
 */

export interface LocaleConfig {
  /** Display label shown in the language picker (native script). */
  label: string
  /**
   * Accept-Language base codes that map to this locale. For en-US this is
   * `['en']` so en-GB / en-AU also resolve here; for es it is `['es']` so
   * es-MX / es-PE / es-AR all collapse here.
   */
  acceptPrefixes: readonly string[]
  /**
   * Translate-script metadata. The English source omits this — there is
   * nothing to translate from English to English. Every other locale must
   * provide it for `npm run i18n:translate -- --target <code>` to work.
   */
  translate?: {
    /** Human-readable language name injected into the translate prompt. */
    name: string
    /** Locale-specific tone / vocabulary rules injected into the prompt. */
    guidance: string
  }
}

export const LOCALES = {
  'en-US': {
    label: 'English',
    acceptPrefixes: ['en'],
  },
  es: {
    label: 'Español',
    acceptPrefixes: ['es'],
    translate: {
      name: 'Spanish',
      guidance: `Spanish-specific rules:
- Use the "usted" form, not "tu".
- Avoid anglicisms where a natural Spanish term exists. Prefer: "Guardar" not "Salvar"; "Atras" not "Espalda"; "Iniciar sesion" not "Loguearse"; "Contrasena" not "Password"; "Correo" not "Email" unless space-constrained.
- Match POS / retail vocabulary the Latin American market actually uses.`,
    },
  },
  ja: {
    label: '日本語',
    acceptPrefixes: ['ja'],
    translate: {
      name: 'Japanese',
      guidance: `Japanese-specific rules:
- Use polite form (desu/masu, です/ます). Do not use plain form (da/ru).
- Do not use overly humble keigo (sonkeigo/kenjogo) — neutral polite is correct for a POS app used by the business owner.
- Use kanji where natural; avoid forcing hiragana for words that are normally written in kanji (e.g. 商品 not しょうひん, 在庫 not ざいこ, 顧客 not こきゃく).
- Use katakana for loanwords that are standard in Japanese retail/POS vocabulary (バーコード, カテゴリ, パスワード, メール, ログイン, ログアウト, アイコン).
- Common POS / inventory vocabulary: 商品 (product), 在庫 (stock), カテゴリ (category), 仕入先 (supplier/provider), 発注 (order), 売上 (sales), 価格 (price), 数量 (quantity), 業務 (business), チーム (team), メンバー (member), オーナー (owner), 招待コード (invite code).
- Buttons / actions stay short. Use 保存 (save), キャンセル (cancel), 削除 (delete), 戻る (back), 次へ (next), 続ける (continue), 完了 (done), 追加 (add), 編集 (edit).
- Do NOT add Japanese sentence-ending punctuation (。) where the English source has none. Mirror the source's punctuation discipline — UI labels, button text, and short headers stay punctuation-free.
- Use full-width Japanese punctuation (。、) only inside actual sentences (toasts, paragraphs, helper text), never inside ICU placeholders or button labels.
- Spacing: do NOT insert spaces between Japanese characters. Keep spaces only around Latin words, numbers, and ICU placeholders ({name}, {count}).`,
    },
  },
  de: {
    label: 'Deutsch',
    acceptPrefixes: ['de'],
    translate: {
      name: 'German',
      guidance: `German-specific rules:
- Use the formal "Sie" form throughout. German commercial software defaults to "Sie"; "du" is too familiar for a business tool.
- POS / retail vocabulary: Produkt, Bestand or Lagerbestand, Kategorie, Lieferant, Bestellung, Verkauf, Preis, Menge, Kunde, Konto, Strichcode or Barcode, Team, Mitglied, Inhaber or Besitzer, Einladungscode.
- Common buttons: Speichern, Abbrechen, Löschen, Zurück, Weiter, Fortfahren, Fertig, Hinzufügen, Bearbeiten.
- Capitalization: German nouns are ALWAYS capitalized regardless of position in sentence (das Produkt, die Bestellung, der Kunde). Verbs and adjectives follow standard sentence case.
- Compound words: prefer single compound forms over hyphenated alternatives when standard (Strichcode not Strich-Code, Einladungscode not Einladungs-Code). Don't over-compound — split if a compound becomes awkwardly long.
- German strings are typically 15-30% longer than English. Watch for button-label fit; prefer shorter synonyms where available (Speichern over Abspeichern).
- Use ß where standard (groß, Straße) and ä/ö/ü for umlauts, never the ae/oe/ue ASCII substitutions.
- Quotation marks: for quoted phrases inside translated values, use escaped ASCII quotes \\"…\\" rather than the typographic „…" pair. The German closing quote codepoint (U+201C) is the same Unicode character as the English opening quote, which the model frequently confuses with an unescaped ASCII " — producing invalid JSON. Escaped ASCII quotes have no such ambiguity and render fine in the app's UI.`,
    },
  },
  fil: {
    label: 'Filipino',
    acceptPrefixes: ['fil', 'tl'],
    translate: {
      name: 'Filipino (Tagalog)',
      guidance: `Filipino-specific rules:
- Target modern conversational Filipino (Tagalog-based national language). Heavy code-switching with English ("Taglish") is normal and expected in commercial/retail contexts — do NOT force pure Tagalog where the natural register mixes English.
- POS / retail terms typically stay in English: product, stock, category, supplier, order, sales, price, quantity, customer, account, barcode, team, member, owner, invite code. Wrapping these in Filipino sentence structure is correct ("Idagdag ang product", "I-save ang changes").
- Common buttons: typically stay in English (Save, Cancel, Delete, Back, Next, Continue, Done, Add, Edit) since the labels are short and English is the dominant UI register in Philippine apps. Translate only when the source uses a longer phrase that benefits from a Filipino verb form.
- Use "po" sparingly — it's polite but adds length. Skip it in buttons and short labels; include in toasts/explanatory text where formality reads naturally.
- Pronouns: use "ka"/"mo" (informal-neutral) rather than "kayo"/"ninyo" for a single-user app.
- Diacritics on Filipino words are uncommon in everyday writing — match the source style (no accents).`,
    },
  },
  fr: {
    label: 'Français',
    acceptPrefixes: ['fr'],
    translate: {
      name: 'French',
      guidance: `French-specific rules:
- Use the formal "vous" form throughout. The app is a business tool; "tu" is too familiar.
- Use metropolitan French vocabulary that also reads naturally to francophone Canadian and West-African users — avoid Quebec-only anglicisms and avoid Belgian/Swiss numeric variants (use "soixante-dix" / "quatre-vingts", not "septante" / "octante").
- POS / retail vocabulary: produit, stock, catégorie, fournisseur, commande, vente, prix, quantité, client, compte, code-barres, équipe, membre, propriétaire, code d'invitation.
- Common buttons: Enregistrer, Annuler, Supprimer, Retour, Suivant, Continuer, Terminé, Ajouter, Modifier.
- Capitalization: French sentence case (only the first letter and proper nouns capitalized); do NOT mirror English Title Case in headers.
- Apostrophes: use typographic curly apostrophes (l'utilisateur, d'inviter) — never ASCII straight ones.
- Standard tech anglicisms are fine: e-mail, login, app — don't force literal calques when the English term is the natural French usage.`,
    },
  },
  it: {
    label: 'Italiano',
    acceptPrefixes: ['it'],
    translate: {
      name: 'Italian',
      guidance: `Italian-specific rules:
- Use the formal "Lei" form (third-person singular conjugation) — Italian commercial software defaults to this register.
- POS / retail vocabulary: prodotto, scorta or stock, categoria, fornitore, ordine, vendita, prezzo, quantità, cliente, account, codice a barre, team or squadra, membro, proprietario, codice invito.
- Common buttons: Salva, Annulla, Elimina, Indietro, Avanti, Continua, Fatto, Aggiungi, Modifica.
- Capitalization: Italian sentence case — only the first letter and proper nouns capitalized. Do NOT mirror English Title Case in headers.
- Apostrophes: use typographic curly apostrophes (l'utente, un'azienda) — never ASCII straight ones.
- Anglicisms common in tech contexts (email, password, login, logout, account, app) are standard — don't force "posta elettronica" / "parola d'ordine" when "email"/"password" reads more naturally.`,
    },
  },
  ko: {
    label: '한국어',
    acceptPrefixes: ['ko'],
    translate: {
      name: 'Korean',
      guidance: `Korean-specific rules:
- Use the polite haeyo (해요) / hapsida (합니다) form. Do NOT use plain banmal (해/한다) — too casual for a business tool.
- Buttons and short labels usually use the nominal/imperative short form (저장, 취소, 삭제, 뒤로, 다음, 계속, 완료, 추가, 편집) rather than full polite verb forms.
- POS / retail vocabulary: 상품 (product), 재고 (stock), 카테고리 (category), 공급업체 (supplier), 주문 (order), 매출 (sales), 가격 (price), 수량 (quantity), 고객 (customer), 계정 (account), 바코드 (barcode), 팀 (team), 구성원 (member), 소유자 (owner), 초대 코드 (invite code).
- Use Hangul for nearly everything; Hanja (Chinese characters) is unnecessary and reads dated.
- Loanwords from English: use the standard Hangul transliteration (이메일, 비밀번호, 로그인, 로그아웃, 메뉴), not awkward native coinages.
- Do NOT add Korean sentence-ending punctuation where the English source has none — UI labels stay punctuation-free.
- Spacing: preserve standard Korean word spacing; do not run words together. Spaces are valid around ICU placeholders and Latin words.`,
    },
  },
  pt: {
    label: 'Português',
    acceptPrefixes: ['pt'],
    translate: {
      name: 'Portuguese (Brazilian)',
      guidance: `Portuguese-specific rules:
- Target Brazilian Portuguese (pt-BR), the largest LATAM Portuguese-speaking market. Avoid Portugal-only terms when a clearer Brazilian alternative exists (prefer "estoque" over "stock", "celular" over "telemóvel", "tela" over "ecrã").
- Use the "você" form — the standard middle register in Brazilian commercial contexts. Do NOT use "tu" (regional/familiar) or "o(a) senhor(a)" (overly formal for app UI).
- POS / retail vocabulary: produto, estoque, categoria, fornecedor, pedido, venda, preço, quantidade, cliente, conta, código de barras, equipe, membro, dono, código de convite.
- Common buttons: Salvar, Cancelar, Excluir, Voltar, Próximo, Continuar, Concluído, Adicionar, Editar.
- Use "E-mail" (with hyphen) and "Senha" rather than "Email"/"Password". "Entrar"/"Sair" for login/logout.
- Preserve Portuguese diacritics exactly (á, ã, ç, é, ê, í, ó, ô, õ, ú).`,
    },
  },
  vi: {
    label: 'Tiếng Việt',
    acceptPrefixes: ['vi'],
    translate: {
      name: 'Vietnamese',
      guidance: `Vietnamese-specific rules:
- Use neutral polite tone — "bạn" (you) where second-person is unavoidable; otherwise prefer impersonal phrasing in buttons/labels. Avoid "anh"/"chị"/"em" personal pronouns since the app doesn't know the user's age/gender.
- POS / retail vocabulary: sản phẩm (product), tồn kho or kho (stock), danh mục (category), nhà cung cấp (supplier), đơn hàng (order), bán hàng / doanh thu (sales), giá (price), số lượng (quantity), khách hàng (customer), tài khoản (account), mã vạch (barcode), nhóm (team), thành viên (member), chủ sở hữu (owner), mã mời (invite code).
- Common buttons: Lưu, Hủy, Xóa, Quay lại, Tiếp, Tiếp tục, Xong, Thêm, Sửa.
- Preserve all Vietnamese diacritics exactly — they distinguish meaning (e.g. "mã" vs "ma", "tài" vs "tai"). Use composed Unicode forms (NFC), never decomposed.
- Loanwords from English: keep "email" as-is; use "mật khẩu" (password), "đăng nhập" (login), "đăng xuất" (logout).
- Vietnamese is on average longer than English — keep translations tight, especially for button labels and column headers.`,
    },
  },
  zh: {
    label: '简体中文',
    acceptPrefixes: ['zh'],
    translate: {
      name: 'Chinese (Simplified)',
      guidance: `Chinese (Simplified) specific rules:
- Use Simplified Chinese characters (简体中文), not Traditional. Target mainland and global Mandarin readers.
- Keep UI strings tight — Chinese UI text is typically 30-50% shorter than English equivalents. Don't pad with politeness particles ("请"/"哦"/"啦") unless the source explicitly calls for them.
- POS / retail vocabulary: 商品 (product), 库存 (stock), 类别 (category), 供应商 (supplier), 订单 (order), 销售 (sales), 价格 (price), 数量 (quantity), 客户 (customer), 账户 (account), 条形码 (barcode), 团队 (team), 成员 (member), 所有者 (owner), 邀请码 (invite code).
- Common buttons: 保存 (save), 取消 (cancel), 删除 (delete), 返回 (back), 下一步 (next), 继续 (continue), 完成 (done), 添加 (add), 编辑 (edit).
- Use full-width punctuation (，。：；！？) only inside actual sentences (toasts, helper text). UI labels and buttons stay punctuation-free, mirroring the English source.
- Do NOT insert ASCII spaces between Chinese characters. Spaces are only valid around Latin words, numbers, and ICU placeholders ({name}, {count}).
- Do NOT translate or transliterate the brand name "Kasero".`,
    },
  },
} as const satisfies Record<string, LocaleConfig>

export type SupportedLocale = keyof typeof LOCALES

export const SUPPORTED_LOCALES = Object.keys(LOCALES) as readonly SupportedLocale[]

export const DEFAULT_LOCALE: SupportedLocale = 'en-US'

/**
 * Look up a locale config by an arbitrary string (e.g. a CLI argument).
 * Returns `undefined` for unknown locales — callers decide how to fall back.
 */
export function getLocaleConfig(locale: string): LocaleConfig | undefined {
  return (LOCALES as Record<string, LocaleConfig>)[locale]
}

/**
 * Resolve a BCP-47 tag (e.g. `'es-PE'`, `'en-GB'`, `'ja-JP'`) to a
 * supported locale via its base prefix. Returns `undefined` when no
 * registered locale claims the prefix.
 */
export function resolveLocaleByPrefix(tag: string): SupportedLocale | undefined {
  const base = tag.split('-')[0].toLowerCase()
  for (const [locale, config] of Object.entries(LOCALES) as [
    SupportedLocale,
    LocaleConfig,
  ][]) {
    if (config.acceptPrefixes.includes(base)) return locale
  }
  return undefined
}
