// The settings window's renderer.
//
// Every control writes straight through to the main process and the change lands
// on the desktop immediately — no Apply button, because there is nothing here
// worth confirming and a pet that changes size as you drag is the point.

const $ = id => document.getElementById(id)

let state = null

// ------------------------------------------------------------------- pets

function drawPets () {
  const host = $('pets')
  host.textContent = ''

  if (!state.pets.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = 'No pets yet. Add one from a few photos, or open a pet file you saved.'
    host.appendChild(p)
    return
  }

  for (const pet of state.pets) {
    const row = document.createElement('div')
    row.className = 'pet'

    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.checked = pet.enabled !== false
    toggle.title = 'Show on the desktop'
    toggle.addEventListener('change', () => window.settingsBridge.togglePet(pet.id, toggle.checked))

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = pet.name

    const rename = document.createElement('button')
    rename.textContent = 'Rename'
    rename.addEventListener('click', () => window.settingsBridge.renamePet(pet.id))

    const forget = document.createElement('button')
    forget.className = 'danger'
    forget.textContent = 'Forget'
    forget.addEventListener('click', () => window.settingsBridge.forgetPet(pet.id))

    row.append(toggle, name, rename, forget)
    host.appendChild(row)
  }
}

// --------------------------------------------------------------- controls

/// Percent of screen height reads as nothing to anyone; their height on the
/// screen in front of them is the thing they can actually picture.
const sizeLabel = scale => `${Math.round(scale * 100)}% tall`

function drawControls () {
  const s = state.settings

  $('scale').value = s.scale
  $('scaleOut').textContent = sizeLabel(s.scale)
  $('speech').checked = s.speech !== false
  $('paused').checked = Boolean(s.paused)
  $('battery').checked = s.pauseOnBatterySaver !== false
  $('activeFps').value = s.activeFps
  $('activeFpsOut').textContent = `${s.activeFps} fps`
  $('openAtLogin').checked = Boolean(state.openAtLogin)
}

function apply (payload) {
  state = payload
  drawPets()
  drawControls()
}

// Live while dragging: the slider is worth having precisely because you can watch
// the animal change on the desktop behind this window.
$('scale').addEventListener('input', () => {
  const scale = Number($('scale').value)
  $('scaleOut').textContent = sizeLabel(scale)
  window.settingsBridge.set({ scale })
})

$('activeFps').addEventListener('input', () => {
  const activeFps = Number($('activeFps').value)
  $('activeFpsOut').textContent = `${activeFps} fps`
  window.settingsBridge.set({ activeFps })
})

$('speech').addEventListener('change', () => window.settingsBridge.set({ speech: $('speech').checked }))
$('paused').addEventListener('change', () => window.settingsBridge.set({ paused: $('paused').checked }))
$('battery').addEventListener('change', () =>
  window.settingsBridge.set({ pauseOnBatterySaver: $('battery').checked }))
$('openAtLogin').addEventListener('change', () =>
  window.settingsBridge.setOpenAtLogin($('openAtLogin').checked))

$('add').addEventListener('click', () => window.settingsBridge.addPet())
$('open').addEventListener('click', () => window.settingsBridge.openFile())

window.settingsBridge.onState(apply)
window.settingsBridge.read().then(apply)
