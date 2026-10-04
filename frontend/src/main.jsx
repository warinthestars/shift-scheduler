import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './utils/push'   // Phase 33: installable app + push notifications
import { installFriendlyErrors } from './utils/apiErrors'   // Phase 33.1: plain-language errors

registerServiceWorker()
installFriendlyErrors()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
