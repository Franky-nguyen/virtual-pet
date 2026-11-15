export interface SlouchScores {
  neck: number
  lowerBack: number
  shoulder: number
}

export interface PostureData {
  status: 'good' | 'slouching' | 'away'
  timestamp: number
  neck?: number
  lowerBack?: number
  shoulder?: number
  scores?: SlouchScores
}
