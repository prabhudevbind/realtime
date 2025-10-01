import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import VoiceCallApp from './VoiceCallApp'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    
     <VoiceCallApp/>

    </>
  )
}

export default App
