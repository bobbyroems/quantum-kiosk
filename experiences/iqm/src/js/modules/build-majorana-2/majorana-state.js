export const MAJORANA_TABS = Object.freeze(['components', 'pathways', 'build'])
export const MAJORANA_PATHWAYS = Object.freeze(['external', 'control', 'readout'])

export const MAJORANA_PARTS = Object.freeze([
  Object.freeze({
    id: 'qpu-stack',
    label: 'QPU stack',
    description: 'The topological qubits reside here.'
  }),
  Object.freeze({
    id: 'cryo-cmos',
    label: 'Cryo-CMOS',
    description: 'Provides digital control for the qubits.'
  })
])

const PART_IDS = new Set(MAJORANA_PARTS.map(part => part.id))
const PATHWAY_IDS = new Set(MAJORANA_PATHWAYS)

export function createMajoranaState() {
  return {
    isStarted: false,
    activeTab: 'components',
    visitedTabs: [],
    selectedPathwayId: null,
    placements: {
      'qpu-stack': false,
      'cryo-cmos': false
    },
    lastDrop: null
  }
}

export function hasVisitedMajoranaTab(state, tab) {
  return MAJORANA_TABS.includes(tab) && state.visitedTabs.includes(tab)
}

function includeVisitedTab(visitedTabs, tab) {
  return visitedTabs.includes(tab)
    ? visitedTabs
    : [...visitedTabs, tab]
}

export function isValidMajoranaDrop(partId, slotId) {
  return PART_IDS.has(partId) && partId === slotId
}

export function getMajoranaBuildProgress(state) {
  return MAJORANA_PARTS.reduce(
    (placedCount, part) => placedCount + Number(Boolean(state.placements[part.id])),
    0
  )
}

export function isMajoranaBuildComplete(state) {
  return getMajoranaBuildProgress(state) === MAJORANA_PARTS.length
}

export function getMajoranaBuildMessage(state) {
  const hasQpu = Boolean(state.placements['qpu-stack'])
  const hasCmos = Boolean(state.placements['cryo-cmos'])

  if (hasQpu && hasCmos) {
    return 'Together, the cryo-CMOS and QPU stack form a complete quantum processing module.'
  }

  if (hasQpu) {
    return 'The QPU stack generates quantum signals. It still needs instructions from the cryo-CMOS.'
  }

  if (hasCmos) {
    return 'The cryo-CMOS sends instructions to the quantum processor. Without a QPU stack, there is nothing to control.'
  }

  return 'Drag and drop the missing components on the M2'
}

export function reduceMajoranaState(state, event) {
  switch (event.type) {
    case 'START':
      return {
        ...state,
        isStarted: true,
        activeTab: 'components',
        visitedTabs: includeVisitedTab(state.visitedTabs, 'components'),
        selectedPathwayId: null,
        lastDrop: null
      }

    case 'NAVIGATE':
      if (!hasVisitedMajoranaTab(state, event.tab)) return state
      return {
        ...state,
        isStarted: true,
        activeTab: event.tab,
        selectedPathwayId: null,
        lastDrop: null
      }

    case 'ADVANCE': {
      if (!state.isStarted) return state
      const activeIndex = MAJORANA_TABS.indexOf(state.activeTab)
      const nextTab = MAJORANA_TABS[activeIndex + 1]
      if (!nextTab || event.tab !== nextTab) return state
      return {
        ...state,
        activeTab: nextTab,
        visitedTabs: includeVisitedTab(state.visitedTabs, nextTab),
        selectedPathwayId: null,
        lastDrop: null
      }
    }

    case 'SELECT_PATHWAY':
      if (
        state.activeTab !== 'pathways' ||
        (event.pathwayId !== null && !PATHWAY_IDS.has(event.pathwayId))
      ) return state
      return {
        ...state,
        selectedPathwayId: event.pathwayId
      }

    case 'DROP_PART': {
      const valid = isValidMajoranaDrop(event.partId, event.slotId)
      if (!valid || state.placements[event.partId]) {
        return {
          ...state,
          lastDrop: {
            partId: event.partId,
            slotId: event.slotId ?? null,
            valid: false
          }
        }
      }

      return {
        ...state,
        isStarted: true,
        activeTab: 'build',
        visitedTabs: includeVisitedTab(state.visitedTabs, 'build'),
        selectedPathwayId: null,
        placements: {
          ...state.placements,
          [event.partId]: true
        },
        lastDrop: {
          partId: event.partId,
          slotId: event.slotId,
          valid: true
        }
      }
    }

    case 'RESTART':
      return createMajoranaState()

    default:
      return state
  }
}
