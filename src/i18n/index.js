import { createI18n } from 'vue-i18n'
import en from './locales/en'
import es from './locales/es'
import fr from './locales/fr'

export const i18n = createI18n({
  legacy: false,
  locale: 'es',
  fallbackLocale: 'es',
  messages: { es, fr, en },
  missingWarn: false,
  fallbackWarn: false,
  warnHtmlMessage: false,
})

/** Translate outside components (stores, models). */
export const t = (key, params) => i18n.global.t(key, params ?? {})
export const setLocale = (locale) => {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}
/** BCP-47 tag for Intl formatting. */
export const intlLocale = () => ({ es: 'es-ES', fr: 'fr-FR', en: 'en-GB' })[i18n.global.locale.value] || 'es-ES'
