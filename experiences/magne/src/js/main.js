/**
 * Main entry point for Vite bundling
 * Imports all modules and makes them available globally
 */

// Third-party libraries
import * as THREE from 'three'
import gsap from 'gsap'
import lottie from 'lottie-web'

// Make THREE available for dynamic scene loading
window.THREE = THREE

// Make gsap available globally (used throughout the app)
window.gsap = gsap

// Make lottie available globally
window.lottie = lottie

// Import app modules (they attach to window.*)
import './slideshow.js'
import './utils/flowLanes.js'
import './templates/connectTemplates.js'
import './templates/computeTemplates.js'
import './templates/controlTemplates.js'
import './tabs/connect.js'
import './tabs/compute.js'
import './tabs/control.js'
import './tabs/index.js'
import './attract.js'
import './interactiveDots.js'
import './interactive.js'
import './shaderWarmup.js'
import './app.js'
