// The tray menu — the app's only real interface.
//
// Everything a person needs is here: which pets are out, where to get more, and
// how to make it stop. There is no settings window, because there is almost
// nothing to set and a window would be one more thing to maintain.

import { Tray, Menu, nativeImage } from 'electron'

let tray = null
let handlers = null

/// A small pet-ish glyph drawn as a template image, so macOS tints it correctly
/// in both light and dark menu bars. Drawn rather than shipped as a file: it is a
/// dozen pixels and this way there is no asset to lose.
function trayIcon () {
  const size = 22
  const canvas = Buffer.alloc(size * size * 4)
  const put = (x, y, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    canvas[i] = 0; canvas[i + 1] = 0; canvas[i + 2] = 0
    canvas[i + 3] = Math.max(canvas[i + 3], Math.round(a * 255))
  }
  // Head.
  const cx = 11, cy = 13, rx = 6.4, ry = 5.6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry)
      if (d <= 1) put(x, y, Math.min(1, (1 - d) * 6))
    }
  }
  // Two ears.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const w = 5 - i
      for (let k = -w / 2; k <= w / 2; k++) {
        put(Math.round(cx + sx * 3.6 + k), Math.round(cy - 4.6 - i * 0.85), 1)
      }
    }
  }
  const image = nativeImage.createFromBuffer(canvas, { width: size, height: size })
  image.setTemplateImage(true)
  return image
}

// Named steps rather than a slider — a native tray menu has no slider, and
// four sizes are plenty of choice for something people set once and forget.
const SIZES = [
  { label: 'Small', value: 0.12 },
  { label: 'Default', value: 0.175 },
  { label: 'Large', value: 0.25 },
  { label: 'Extra large', value: 0.35 },
]

export function createTray (h) {
  handlers = h
  tray = new Tray(trayIcon())
  tray.setToolTip('Still Around')
  refreshTray()
  return tray
}

export function refreshTray () {
  if (!tray || !handlers) return
  const state = handlers.getState()

  const petItems = state.pets.length
    ? state.pets.map(pet => ({
        label: pet.name,
        submenu: [
          {
            label: 'On the desktop',
            type: 'checkbox',
            checked: pet.enabled !== false,
            click: item => handlers.onTogglePet(pet.id, item.checked),
          },
          { type: 'separator' },
          { label: `Forget ${pet.name}`, click: () => handlers.onRemove(pet.id) },
        ],
      }))
    : [{ label: 'No pets yet', enabled: false }]

  // The saved value might not land on a step exactly — an old file, or one
  // dragged partway there before this menu existed — so pick the nearest
  // rather than requiring an exact match to show anything checked.
  const currentScale = state.settings?.scale ?? 0.175
  const closestSize = SIZES.reduce((best, s) =>
    Math.abs(s.value - currentScale) < Math.abs(best.value - currentScale) ? s : best, SIZES[0])

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Still Around', enabled: false },
    { type: 'separator' },
    ...petItems,
    { type: 'separator' },
    { label: 'Open a pet file…', click: () => handlers.onImport() },
    { label: 'Make one from photos…', click: () => handlers.onMakeOne() },
    { type: 'separator' },
    {
      label: 'Show on screen',
      type: 'checkbox',
      checked: state.visible !== false,
      click: item => handlers.onToggleVisible(item.checked),
    },
    {
      label: 'Size',
      submenu: SIZES.map(s => ({
        label: s.label,
        type: 'radio',
        checked: s.value === closestSize.value,
        click: () => handlers.onSetScale(s.value),
      })),
    },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: handlers.getOpenAtLogin(),
      click: item => handlers.onOpenAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => handlers.onQuit() },
  ]))
}
