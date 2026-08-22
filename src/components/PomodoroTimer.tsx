import { useState, useEffect, useRef } from 'react'

interface PomodoroTimerProps {
  isWorkPhase: boolean
  onPhaseChange: (isWork: boolean) => void
}

const WORK_DURATION = 45 * 60 // 45 minutes in seconds
const REST_DURATION = 5 * 60  // 5 minutes in seconds

export default function PomodoroTimer({ isWorkPhase, onPhaseChange }: PomodoroTimerProps) {
  const [timeLeft, setTimeLeft] = useState(WORK_DURATION)
  const [isRunning, setIsRunning] = useState(false)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            // Phase complete - switch
            const nextPhase = !isWorkPhase
            onPhaseChange(nextPhase)
            setIsRunning(false)
            return nextPhase ? WORK_DURATION : REST_DURATION
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isRunning, isWorkPhase, onPhaseChange])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleStartPause = () => {
    setIsRunning(!isRunning)
  }

  const handleReset = () => {
    setIsRunning(false)
    setTimeLeft(isWorkPhase ? WORK_DURATION : REST_DURATION)
  }

  const progress = isWorkPhase
    ? ((WORK_DURATION - timeLeft) / WORK_DURATION) * 100
    : ((REST_DURATION - timeLeft) / REST_DURATION) * 100

  return (
    <div className="w-full bg-white/20 backdrop-blur-sm rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-white font-semibold text-lg">
          {isWorkPhase ? '🎯 Work Time' : '☕ Rest Time'}
        </span>
        <span className="text-white/80 text-sm">
          {isWorkPhase ? '45m' : '5m'}
        </span>
      </div>

      <div className="text-5xl font-bold text-white text-center mb-4">
        {formatTime(timeLeft)}
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white/20 rounded-full mb-6">
        <div
          className="h-full bg-white rounded-full transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        <button
          onClick={handleStartPause}
          className="flex-1 bg-white text-purple-600 font-semibold py-3 rounded-xl hover:bg-white/90 transition-colors"
        >
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button
          onClick={handleReset}
          className="px-6 bg-white/20 text-white font-semibold py-3 rounded-xl hover:bg-white/30 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
