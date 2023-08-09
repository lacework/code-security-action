export interface LWJSON {
  FixSuggestions?: FixSuggestion[]
}

// Fix suggestion

export interface FixVersion {
  Type?: string
  Version?: string
}

export interface Info {
  FixVersion?: FixVersion
  Diffs?: string[][]
}
export interface FixSuggestion {
  FixId: string
  Info: Info
}
