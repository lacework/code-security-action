export interface LWJSON {
  Artifacts?: Artifact[]
  FixSuggestions?: FixSuggestion[]
}

// Fix suggestion

export interface FixVersion {
  Type?: string
  Version?: string
}

export interface Info {
  fixVersion?: FixVersion | undefined
  Diffs?: string[][] | undefined
}
export interface FixSuggestion {
  FixId: string
  Info: Info
}
