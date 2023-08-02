export interface LWJSON {
  FixSuggestions?: FixSuggestion[]
}

export interface FixVersion {
  Type?: string
  Version?: string
}

export interface Info {
  fixVersion?: FixVersion | undefined
  Diffs?: string[][] | undefined
}
export interface FixSuggestion {
  fixId: string
  Info: Info
}
