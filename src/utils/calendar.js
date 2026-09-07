/**
 * "Add to calendar" helpers for follow-ups. A PWA cannot write to the phone's calendar
 * directly, so we hand the event to the native calendar app: an .ics file (iOS/Android)
 * or a Google Calendar link.
 */
function pad(n) {
  return String(n).padStart(2, '0')
}
function icsUtc(ts) {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}
function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`)
}

export function followUpToIcs(f, { durationMin = 30 } = {}) {
  const start = f.remindAt
  const end = start + durationMin * 60_000
  const desc = [f.description, f.propertyLabel && `Propiedad: ${f.propertyLabel}`, f.clientLabel && `Cliente: ${f.clientLabel}`].filter(Boolean).join('\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ALMA//Inmovilla PWA//ES',
    'BEGIN:VEVENT',
    `UID:alma-${f.remoteId || f.id}@alma-inmovilla`,
    `DTSTAMP:${icsUtc(Date.now())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${esc([f.typeName, f.subject].filter(Boolean).join(' · '))}`,
    desc ? `DESCRIPTION:${esc(desc)}` : null,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}

export function icsDataUrl(f) {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(followUpToIcs(f))}`
}

export function googleCalendarUrl(f, { durationMin = 30 } = {}) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: [f.typeName, f.subject].filter(Boolean).join(' · '),
    dates: `${icsUtc(f.remindAt)}/${icsUtc(f.remindAt + durationMin * 60_000)}`,
    details: [f.description, f.propertyLabel && `Propiedad: ${f.propertyLabel}`, f.clientLabel && `Cliente: ${f.clientLabel}`].filter(Boolean).join('\n'),
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

/** Open the native calendar with this event (download .ics; falls back to Google Calendar). */
export function addToNativeCalendar(f) {
  try {
    const a = document.createElement('a')
    a.href = icsDataUrl(f)
    a.download = `seguimiento-${(f.subject || 'alma').replace(/[^\w-]+/g, '_').slice(0, 40)}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  } catch {
    window.open(googleCalendarUrl(f), '_blank', 'noopener')
    return false
  }
}
