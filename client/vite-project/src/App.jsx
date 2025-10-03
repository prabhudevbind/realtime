import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import SimpleVoiceCall from './SimpleVoiceCall'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    
     <SimpleVoiceCall/>

    </>
  )
}

export default App
