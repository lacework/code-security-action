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

// Artifact

export interface Artifact {
  Id: string 
  Name: string 
  Path: string 
  Timestamp: string 
  Type: string 
  Class: string 
  Language: string 
}
