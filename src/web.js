// FinderDemo — self-contained R3F concept visualization for an item-tracking product.
// Devices built entirely from primitive geometries:
//   1. STICKER  — thin disc carrying a UPenn-styled decal (drawn on a canvas, no
//                 external asset), adhered to the lid of a laptop prop
//   2. FINDER   — charcoal puck with a sweeping LED compass ring, keychain loop,
//                 and a circular SCREEN on top showing a direction arrow + live
//                 distance estimate (rendered onto a canvas texture)
// Modes:
//   "Show how it works" — the laptop roams to different positions/distances; the
//                          LED ring and the puck's screen track it live
//   "What's inside"     — magnified exploded view of the sticker's internal
//                          layers (adhesive, PCB, UWB/BLE chips, antenna trace,
//                          coin cell, shell) that separates and re-assembles

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, RoundedBox, Html } from '@react-three/drei'
import * as THREE from 'three'

const LED_COUNT = 24
const PUCK_POS = [4.0, 1.6, -2.9] // resting on the desk
const UNITS_TO_FEET = 3.2 // scene units -> "feet" for the distance estimate

// Named resting spots the laptop wanders between, each sitting on a real surface.
// index 0 is "home" (where it rests while idle).
const SPOTS = [
  { name: 'On the bed', pos: [-4.6, 1.05, -2.4] },
  { name: 'On the desk', pos: [2.4, 1.42, -4.0] },
  { name: 'On the nightstand', pos: [-1.8, 1.13, -3.9] },
  { name: 'On the rug', pos: [0.3, 0.04, 0.9] },
  { name: 'At the foot of the bed', pos: [-3.0, 1.05, -0.6] },
]
const LAPTOP_HOME = SPOTS[0].pos
const nextSpotIndex = (prev) => {
  let i = prev
  while (i === prev) i = Math.floor(Math.random() * SPOTS.length)
  return i
}

const IDLE_COLOR = new THREE.Color('#38e0c8') // teal sweep while idle
const SEEK_COLOR = new THREE.Color('#3fa9ff') // blue lock when seeking

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smooth = (x) => x * x * (3 - 2 * x)

const shortestAngle = (a, b) => {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

// bearing (rotation about Y) from puck -> point, matching LED layout x=cos a, z=-sin a
const bearingTo = (x, z) => Math.atan2(-(z - PUCK_POS[2]), x - PUCK_POS[0])

/* ---------------- UPenn sticker decal (canvas texture, self-contained) --------------- */

function drawArcText(ctx, text, cx, cy, radius, centerAngle, arcSpan, bottom) {
  const chars = [...text]
  const per = arcSpan / Math.max(chars.length, 1)
  chars.forEach((ch, i) => {
    const t = i - (chars.length - 1) / 2
    const ang = centerAngle + (bottom ? -t * per : t * per)
    ctx.save()
    ctx.translate(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius)
    ctx.rotate(bottom ? ang - Math.PI / 2 : ang + Math.PI / 2)
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
}

function usePennTexture() {
  return useMemo(() => {
    const S = 512
    const c = document.createElement('canvas')
    c.width = c.height = S
    const ctx = c.getContext('2d')
    const cx = S / 2
    const cy = S / 2
    // University of Pennsylvania coat of arms
    const RED = '#9E1B34'
    const BLUE = '#01285C'
    const SILVER = '#F2F0EA'

    ctx.clearRect(0, 0, S, S)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // white sticker base + die-cut edge
    ctx.beginPath()
    ctx.arc(cx, cy, 248, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#e3e3e0'
    ctx.beginPath()
    ctx.arc(cx, cy, 244, 0, Math.PI * 2)
    ctx.stroke()

    // shield outline (escutcheon)
    const sTop = 96
    const sL = 150
    const sR = 362
    const sCurve = 250
    const sBot = 360
    const chiefBot = 162
    const shieldPath = () => {
      ctx.beginPath()
      ctx.moveTo(sL, sTop)
      ctx.lineTo(sR, sTop)
      ctx.lineTo(sR, sCurve)
      ctx.quadraticCurveTo(sR, sCurve + 66, cx, sBot)
      ctx.quadraticCurveTo(sL, sCurve + 66, sL, sCurve)
      ctx.closePath()
    }

    // motto banner (behind the shield point)
    const by = 372
    ctx.fillStyle = '#e2dccb'
    ;[[90, 1], [422, -1]].forEach(([ex, dir]) => {
      ctx.beginPath()
      ctx.moveTo(ex, by - 24)
      ctx.lineTo(ex - dir * 32, by - 4)
      ctx.lineTo(ex, by + 6)
      ctx.closePath()
      ctx.fill()
    })
    ctx.beginPath()
    ctx.moveTo(96, by - 18)
    ctx.lineTo(416, by - 18)
    ctx.quadraticCurveTo(430, by, 416, by + 18)
    ctx.lineTo(96, by + 18)
    ctx.quadraticCurveTo(82, by, 96, by - 18)
    ctx.closePath()
    ctx.fillStyle = '#efe9dc'
    ctx.fill()
    ctx.strokeStyle = RED
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.fillStyle = '#6d1526'
    ctx.font = 'italic 700 20px Georgia, serif'
    ctx.fillText('LEGES  SINE MORIBUS  VANAE', cx, by + 1)

    // shield fields
    ctx.save()
    shieldPath()
    ctx.clip()
    ctx.fillStyle = BLUE
    ctx.fillRect(0, 0, S, S)
    ctx.fillStyle = RED
    ctx.fillRect(0, 0, S, chiefBot)
    // white chevron
    ctx.strokeStyle = SILVER
    ctx.lineWidth = 26
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(184, 274)
    ctx.lineTo(cx, 206)
    ctx.lineTo(328, 274)
    ctx.stroke()
    // three roundels (plates)
    ctx.fillStyle = SILVER
    ;[[206, 196], [306, 196], [cx, 300]].forEach(([x, y]) => {
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.restore()

    // chief: two open books
    const drawBook = (bx) => {
      ctx.save()
      ctx.translate(bx, 128)
      ctx.fillStyle = SILVER
      ctx.strokeStyle = '#6d1526'
      ctx.lineWidth = 1.5
      ;[-1, 1].forEach((s) => {
        ctx.beginPath()
        ctx.moveTo(0, -11)
        ctx.quadraticCurveTo(s * 15, -17, s * 27, -10)
        ctx.lineTo(s * 27, 9)
        ctx.quadraticCurveTo(s * 15, 2, 0, 8)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      })
      ctx.strokeStyle = 'rgba(109,21,38,0.4)'
      ctx.lineWidth = 1
      for (let i = 1; i <= 3; i++) {
        const yy = -8 + i * 4
        ;[-1, 1].forEach((s) => {
          ctx.beginPath()
          ctx.moveTo(s * 22, yy)
          ctx.quadraticCurveTo(s * 11, yy - 4, s * 2, yy + 2)
          ctx.stroke()
        })
      }
      ctx.restore()
    }
    drawBook(200)
    drawBook(312)

    // chief: dolphin embowed, centered
    ctx.save()
    ctx.translate(cx, 130)
    ctx.fillStyle = SILVER
    ctx.beginPath()
    ctx.moveTo(-22, 4)
    ctx.bezierCurveTo(-26, -12, -6, -20, 8, -14)
    ctx.bezierCurveTo(16, -11, 20, -6, 24, -10)
    ctx.lineTo(30, -3)
    ctx.bezierCurveTo(25, 1, 23, -2, 19, 3)
    ctx.lineTo(25, 12)
    ctx.bezierCurveTo(17, 7, 15, 11, 7, 9)
    ctx.bezierCurveTo(-4, 13, -17, 13, -22, 4)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = BLUE
    ctx.beginPath()
    ctx.arc(-10, -7, 2.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // shield border
    shieldPath()
    ctx.strokeStyle = '#0a1f45'
    ctx.lineWidth = 4
    ctx.lineJoin = 'round'
    ctx.stroke()

    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    tex.needsUpdate = true
    return tex
  }, [])
}

// Uses the exact crest image if one is supplied at public/penn-crest.png,
// otherwise falls back to the drawn crest above. Drop in a square PNG
// (transparent or white background) to get a pixel-exact sticker.
function useStickerTexture() {
  const fallback = usePennTexture()
  const [img, setImg] = useState(null)
  useEffect(() => {
    let alive = true
    const url = import.meta.env.BASE_URL + 'penn-crest.png'
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        if (!alive || !r.ok) return
        new THREE.TextureLoader().load(url, (t) => {
          t.colorSpace = THREE.SRGBColorSpace
          t.anisotropy = 8
          if (alive) setImg(t)
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return img || fallback
}

/* ---------------- DOM label ---------------- */

function Label({ position, children }) {
  return (
    <Html position={position} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          whiteSpace: 'nowrap',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.02em',
          color: '#6e6e73',
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(6px)',
          padding: '4px 10px',
          borderRadius: 999,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        {children}
      </div>
    </Html>
  )
}

/* ---------------- Laptop prop with Penn sticker (the tracked item) ---------------- */

function LaptopWithSticker({ mode, targetRef, worldPosRef }) {
  const group = useRef()
  const baseY = useRef(LAPTOP_HOME[1]) // resting height, lerped between surfaces
  const pennTex = useStickerTexture()

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const t = targetRef.current
    const k = 1 - Math.pow(0.0025, delta) // framerate-independent smoothing
    g.position.x += (t[0] - g.position.x) * k
    g.position.z += (t[2] - g.position.z) * k
    baseY.current += (t[1] - baseY.current) * k
    const dist = Math.hypot(t[0] - g.position.x, t[2] - g.position.z)
    const hop = Math.min(dist * 0.16, 0.7) // arc up while travelling between spots
    g.position.y = baseY.current + hop
    worldPosRef.current.set(g.position.x, g.position.y, g.position.z)
  })

  return (
    <group ref={group} position={LAPTOP_HOME} scale={0.72}>
      {/* keyboard deck, receding away from camera */}
      <RoundedBox args={[2.2, 0.1, 1.5]} radius={0.04} smoothness={4} position={[0, 0.06, -0.72]} castShadow receiveShadow>
        <meshStandardMaterial color="#c8ccd2" roughness={0.35} metalness={0.75} />
      </RoundedBox>
      <mesh position={[0, 0.111, -0.78]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.9, 1.05]} />
        <meshStandardMaterial color="#2b2e33" roughness={0.6} metalness={0.3} />
      </mesh>

      {/* lid (reclined), sticker adhered flat to its outward face */}
      <group position={[0, 0.12, 0.06]} rotation={[-0.16, 0, 0]}>
        <RoundedBox args={[2.2, 1.46, 0.08]} radius={0.04} smoothness={4} position={[0, 0.74, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#c8ccd2" roughness={0.35} metalness={0.78} />
        </RoundedBox>

        {/* Penn sticker: thin disc (axis along lid normal) + printed decal */}
        <group position={[0, 0.92, 0.045]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.44, 0.44, 0.02, 64]} />
            <meshStandardMaterial color="#ffffff" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.43, 64]} />
            <meshStandardMaterial map={pennTex} roughness={0.75} transparent />
          </mesh>
          {mode === 'seek' && <PingRing />}
        </group>
      </group>

      <Label position={[0, -0.3, 1.1]}>Sticker (on your laptop)</Label>
    </group>
  )
}

/* expanding "I'm here" ping on the sticker while being located */
function PingRing() {
  const ref = useRef()
  useFrame(({ clock }) => {
    const p = (clock.elapsedTime % 1.6) / 1.6
    const s = 0.8 + p * 1.7
    ref.current.scale.set(s, s, 1)
    ref.current.material.opacity = 0.55 * (1 - p)
  })
  return (
    <mesh ref={ref} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.44, 0.5, 64]} />
      <meshBasicMaterial color="#3fa9ff" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  )
}

/* ---------------- Finder puck: LED ring + on-device screen ---------------- */

function FinderPuck({ mode, stickerWorldPos, hintRef, spotNameRef }) {
  const ledRefs = useRef([])
  const sweep = useRef(0)

  const screen = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return { ctx: c.getContext('2d'), tex }
  }, [])

  const leds = useMemo(
    () =>
      Array.from({ length: LED_COUNT }, (_, i) => {
        const a = (i / LED_COUNT) * Math.PI * 2
        return { angle: a, pos: [Math.cos(a) * 0.72, 0, -Math.sin(a) * 0.72] }
      }),
    []
  )

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const sx = stickerWorldPos.current.x
    const sz = stickerWorldPos.current.z
    const target = bearingTo(sx, sz)

    if (mode === 'seek') {
      sweep.current += shortestAngle(target, sweep.current) * Math.min(1, delta * 5)
    } else {
      sweep.current += delta * 2.2 // idle clock-hand sweep
    }

    const width = mode === 'seek' ? 0.3 : 0.55
    const pulse = mode === 'seek' ? 0.7 + 0.3 * Math.sin(t * 7) : 1
    const color = mode === 'seek' ? SEEK_COLOR : IDLE_COLOR

    ledRefs.current.forEach((m, i) => {
      if (!m) return
      const d = shortestAngle(leds[i].angle, sweep.current)
      const g = Math.exp(-(d * d) / (2 * width * width))
      m.material.emissive.copy(color)
      m.material.emissiveIntensity = 0.08 + g * 3.2 * pulse
      m.material.color.copy(color).multiplyScalar(0.25 + g * 0.75)
    })

    const feet = Math.round(Math.hypot(sx - PUCK_POS[0], sz - PUCK_POS[2]) * UNITS_TO_FEET)
    const near = feet <= 3
    if (hintRef?.current) {
      const where = spotNameRef?.current || 'This way'
      hintRef.current.textContent = near ? 'Right here' : `${where} · ≈ ${feet} ft away`
    }

    /* ---- draw the on-device screen (viewed from above: +X right, +Z down) ---- */
    const ctx = screen.ctx
    ctx.clearRect(0, 0, 256, 256)
    ctx.fillStyle = '#08090b'
    ctx.beginPath()
    ctx.arc(128, 128, 128, 0, Math.PI * 2)
    ctx.fill()

    if (mode === 'seek') {
      const phi = -sweep.current // canvas angle for the eased bearing
      ctx.save()
      ctx.translate(128, 104)
      ctx.rotate(phi)
      ctx.strokeStyle = '#3fa9ff'
      ctx.fillStyle = '#3fa9ff'
      ctx.lineWidth = 16
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-38, 0)
      ctx.lineTo(26, 0)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(58, 0)
      ctx.lineTo(18, -24)
      ctx.lineTo(18, 24)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '700 46px -apple-system, "Helvetica Neue", Arial, sans-serif'
      ctx.fillText(near ? 'Here' : `${feet} ft`, 128, 196)
    } else {
      // idle face: dim sweep line + breathing dot, matching the LED ring
      const phi = -sweep.current
      ctx.strokeStyle = 'rgba(56,224,200,0.35)'
      ctx.lineWidth = 6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(128, 128)
      ctx.lineTo(128 + Math.cos(phi) * 88, 128 + Math.sin(phi) * 88)
      ctx.stroke()
      ctx.fillStyle = `rgba(56,224,200,${0.5 + 0.3 * Math.sin(t * 2.5)})`
      ctx.beginPath()
      ctx.arc(128, 128, 10, 0, Math.PI * 2)
      ctx.fill()
    }
    screen.tex.needsUpdate = true
  })

  return (
    <group position={PUCK_POS} scale={0.8}>
      {/* signature glow: the ring pools coloured light onto the desk while seeking */}
      {mode === 'seek' && (
        <pointLight position={[0, 0.7, 0]} color="#3fa9ff" intensity={5} distance={4} decay={2} />
      )}
      {/* body: charcoal puck */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.82, 0.82, 0.42, 64]} />
        <meshStandardMaterial color="#2b2b2e" roughness={0.45} metalness={0.35} />
      </mesh>
      {/* recessed LED channel */}
      <mesh position={[0, 0.21, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.64, 0.78, 64]} />
        <meshStandardMaterial color="#1c1c1f" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      {/* screen bezel + display face */}
      <mesh position={[0, 0.215, 0]}>
        <cylinderGeometry args={[0.63, 0.66, 0.02, 64]} />
        <meshStandardMaterial color="#141417" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.227, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.58, 64]} />
        <meshBasicMaterial map={screen.tex} toneMapped={false} />
      </mesh>

      {/* LED segments */}
      {leds.map((l, i) => (
        <mesh
          key={i}
          ref={(el) => (ledRefs.current[i] = el)}
          position={[l.pos[0], 0.225, l.pos[2]]}
          rotation={[0, l.angle, 0]}
        >
          <boxGeometry args={[0.07, 0.02, 0.14]} />
          <meshStandardMaterial color="#0f3d38" emissive={IDLE_COLOR} emissiveIntensity={0.1} toneMapped={false} />
        </mesh>
      ))}

      {/* keychain loop + lug */}
      <group position={[-1.02, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow>
          <torusGeometry args={[0.26, 0.055, 16, 40]} />
          <meshStandardMaterial color="#b9bcc2" roughness={0.3} metalness={0.9} />
        </mesh>
      </group>
      <mesh position={[-0.84, 0, 0]} castShadow>
        <boxGeometry args={[0.22, 0.2, 0.3]} />
        <meshStandardMaterial color="#2b2b2e" roughness={0.45} metalness={0.35} />
      </mesh>

      <Label position={[0, -0.6, 1.1]}>Finder (keychain/wristband)</Label>
    </group>
  )
}

/* glowing signal that arcs across the room from the puck to the laptop while seeking */
function SignalDots({ stickerWorldPos }) {
  const refs = useRef([])
  const N = 7
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    a.set(PUCK_POS[0], PUCK_POS[1] + 0.1, PUCK_POS[2])
    b.set(stickerWorldPos.current.x, stickerWorldPos.current.y + 0.5, stickerWorldPos.current.z)
    const lift = 0.6 + a.distanceTo(b) * 0.12 // arc higher over longer trips
    for (let i = 0; i < N; i++) {
      const m = refs.current[i]
      if (!m) continue
      const p = (t * 0.4 + i / N) % 1
      m.position.lerpVectors(a, b, p)
      m.position.y += Math.sin(Math.PI * p) * lift // parabolic arc
      m.material.opacity = 0.55 * Math.sin(Math.PI * p)
    }
  })
  return (
    <>
      {Array.from({ length: N }, (_, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshBasicMaterial color="#3fa9ff" transparent opacity={0} toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}

/* ---------------- Exploded view of the sticker internals (magnified) ---------------- */
/* Real proportions: ~30mm dia x ~3mm thick. Shown here magnified; assembled stack
   keeps the same ~1:10 thickness-to-diameter ratio (0.35 units on a 3.0 dia disc). */

const R = 1.5 // magnified sticker radius
const LAYERS = [
  { key: 'adhesive', assembledY: 0.015, explodedY: 0.1 },
  { key: 'pcb', assembledY: 0.0525, explodedY: 0.85 },
  { key: 'chips', assembledY: 0.105, explodedY: 1.6 },
  { key: 'antenna', assembledY: 0.09, explodedY: 2.35 },
  { key: 'battery', assembledY: 0.225, explodedY: 3.1 },
  { key: 'shell', assembledY: 0.35, explodedY: 3.85 },
]

function ExplodedSticker({ closing, onClosed }) {
  const layerRefs = useRef({})
  const labelRefs = useRef({})
  const eRef = useRef(0) // 0 = sealed shut, 1 = fully exploded
  const tRef = useRef(0) // phase timer
  const startE = useRef(0) // e value at the moment closing began
  const phaseRef = useRef('wait') // 'wait' | 'open' | 'open-hold' | 'closing' | 'done'
  const closedCalled = useRef(false)
  const pennTex = useStickerTexture()

  // detail textures for the internals, all drawn in-code (no external assets)
  const detailTex = useMemo(() => {
    const make = (size, draw) => {
      const c = document.createElement('canvas')
      c.width = c.height = size
      draw(c.getContext('2d'), size)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      return t
    }

    const pcb = make(512, (ctx, S) => {
      ctx.fillStyle = '#0e5227'
      ctx.fillRect(0, 0, S, S)
      // copper traces routed out from the two chip footprints
      ctx.strokeStyle = '#caa04e'
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      const routes = [
        [[256, 256], [256, 150], [180, 150], [180, 90]],
        [[256, 256], [256, 360], [330, 360], [330, 420]],
        [[190, 256], [120, 256], [120, 180]],
        [[322, 256], [400, 256], [400, 330]],
        [[190, 280], [140, 330], [140, 390]],
        [[322, 230], [380, 170], [430, 170]],
        [[220, 256], [220, 380], [160, 440]],
        [[290, 256], [290, 120], [350, 80]],
      ]
      routes.forEach((r) => {
        ctx.beginPath()
        ctx.moveTo(r[0][0], r[0][1])
        r.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]))
        ctx.stroke()
      })
      // gold pads with drilled vias
      const pads = [
        [180, 90], [330, 420], [120, 180], [400, 330], [140, 390], [430, 170],
        [160, 440], [350, 80], [80, 256], [432, 256], [256, 60], [256, 452],
      ]
      ctx.fillStyle = '#d8b25f'
      pads.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill() })
      ctx.fillStyle = '#0a3d1e'
      pads.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill() })
      // silkscreen chip footprints + board marking
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 3
      ctx.strokeRect(150, 210, 92, 92)
      ctx.strokeRect(280, 214, 84, 84)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '600 22px Menlo, monospace'
      ctx.fillText('U1', 150, 200)
      ctx.fillText('U2', 280, 204)
      ctx.fillText('PENN-FIND r2', 168, 490)
    })

    const battery = make(512, (ctx, S) => {
      const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 256)
      g.addColorStop(0, '#eceef1')
      g.addColorStop(1, '#c2c7cd')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, S, S)
      ctx.fillStyle = '#878d95'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '700 64px -apple-system, Arial, sans-serif'
      ctx.fillText('CR2016', 256, 240)
      ctx.font = '600 44px -apple-system, Arial, sans-serif'
      ctx.fillText('3V', 256, 306)
      ctx.font = '700 84px -apple-system, Arial, sans-serif'
      ctx.fillText('+', 256, 128)
    })

    const chip = (label, part) =>
      make(128, (ctx) => {
        ctx.fillStyle = '#141417'
        ctx.fillRect(0, 0, 128, 128)
        ctx.fillStyle = '#e8e8ec'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = '700 34px Menlo, monospace'
        ctx.fillText(label, 64, 56)
        ctx.font = '400 17px Menlo, monospace'
        ctx.fillText(part, 64, 90)
        ctx.fillStyle = '#9a9aa2'
        ctx.beginPath()
        ctx.arc(22, 22, 7, 0, Math.PI * 2)
        ctx.fill()
      })

    return { pcb, battery, uwb: chip('UWB', 'DW-3110'), ble: chip('BLE', 'NRF-528') }
  }, [])

  useFrame((_, delta) => {
    const WAIT = 1.0 // sit closed for a beat before opening
    const OPEN_DUR = 3.0 // slow, deliberate reveal
    const CLOSE_DUR = 1.0

    // Back was pressed → begin closing from wherever we are
    if (closing && phaseRef.current !== 'closing' && phaseRef.current !== 'done') {
      if (eRef.current < 0.02) {
        phaseRef.current = 'done'
        if (!closedCalled.current) {
          closedCalled.current = true
          onClosed && onClosed()
        }
      } else {
        phaseRef.current = 'closing'
        tRef.current = 0
        startE.current = eRef.current
      }
    }

    const p = phaseRef.current
    if (p === 'wait') {
      tRef.current += delta
      eRef.current = 0
      if (tRef.current >= WAIT) {
        phaseRef.current = 'open'
        tRef.current = 0
      }
    } else if (p === 'open') {
      tRef.current += delta
      eRef.current = smooth(Math.min(tRef.current / OPEN_DUR, 1))
      if (tRef.current >= OPEN_DUR) phaseRef.current = 'open-hold'
    } else if (p === 'open-hold') {
      eRef.current = 1
    } else if (p === 'closing') {
      tRef.current += delta
      const k = Math.min(tRef.current / CLOSE_DUR, 1)
      eRef.current = startE.current * (1 - smooth(k))
      if (k >= 1) {
        eRef.current = 0
        phaseRef.current = 'done'
        if (!closedCalled.current) {
          closedCalled.current = true
          onClosed && onClosed()
        }
      }
    } else {
      eRef.current = 0
    }

    const e = eRef.current
    LAYERS.forEach((L) => {
      const g = layerRefs.current[L.key]
      if (g) g.position.y = L.assembledY + (L.explodedY - L.assembledY) * e
    })
    Object.values(labelRefs.current).forEach((el) => {
      if (el) el.style.opacity = String(Math.max(0, e * 1.4 - 0.4))
    })
  })

  const setLayer = (k) => (el) => (layerRefs.current[k] = el)
  const setLabel = (k) => (el) => (labelRefs.current[k] = el)

  const layerLabel = (k, text, x, extra) => (
    <Html position={[x, 0, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div
        ref={setLabel(k)}
        style={{
          whiteSpace: 'nowrap',
          fontSize: 12,
          fontWeight: 600,
          color: '#1d1d1f',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(6px)',
          padding: '4px 10px',
          borderRadius: 999,
          boxShadow: '0 1px 5px rgba(0,0,0,0.1)',
          opacity: 0,
          transition: 'opacity 0.15s',
          textAlign: 'center',
        }}
      >
        {text}
        {extra && <div style={{ fontWeight: 400, fontSize: 10, color: '#86868b' }}>{extra}</div>}
      </div>
    </Html>
  )

  return (
    <group position={[0, 0.4, 0]}>
      {/* 1 — adhesive backing, with a peel-liner tab */}
      <group ref={setLayer('adhesive')}>
        <mesh castShadow>
          <cylinderGeometry args={[R, R, 0.03, 64]} />
          <meshStandardMaterial color="#d9cba8" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[R - 0.4, R - 0.06, 64]} />
          <meshStandardMaterial color="#cfc09a" roughness={1} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[R + 0.08, 0, 0]} castShadow>
          <boxGeometry args={[0.32, 0.014, 0.22]} />
          <meshStandardMaterial color="#e8dfc4" roughness={0.95} />
        </mesh>
        {layerLabel('adhesive', 'Adhesive backing', 2.6, 'Holds the tag onto your device')}
      </group>

      {/* 2 — PCB: printed traces, pads, silkscreen + a few passives */}
      <group ref={setLayer('pcb')}>
        <mesh castShadow>
          <cylinderGeometry args={[R - 0.06, R - 0.06, 0.045, 64]} />
          <meshStandardMaterial color="#14602f" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.0235, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[R - 0.07, 64]} />
          <meshStandardMaterial map={detailTex.pcb} roughness={0.5} />
        </mesh>
        {[
          { p: [-0.15, 0.62], c: '#8a5a2b' },
          { p: [0.2, -0.66], c: '#33343a' },
          { p: [0.75, 0.45], c: '#8a5a2b' },
          { p: [-0.8, -0.4], c: '#44454c' },
          { p: [0.05, 0.98], c: '#8a5a2b' },
          { p: [-1.0, 0.25], c: '#33343a' },
        ].map((v, i) => (
          <mesh key={i} position={[v.p[0], 0.043, v.p[1]]} rotation={[0, (i * 1.1) % 1.6, 0]} castShadow>
            <boxGeometry args={[0.12, 0.04, 0.07]} />
            <meshStandardMaterial color={v.c} roughness={0.5} metalness={0.2} />
          </mesh>
        ))}
        {layerLabel('pcb', 'PCB', -2.4, 'Wires all the parts together')}
      </group>

      {/* 3 — UWB + BLE chips: laser markings + gold pins */}
      <group ref={setLayer('chips')}>
        <mesh position={[-0.55, 0, 0]} castShadow>
          <boxGeometry args={[0.44, 0.06, 0.44]} />
          <meshStandardMaterial color="#1b1b1e" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh position={[-0.55, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.42, 0.42]} />
          <meshStandardMaterial map={detailTex.uwb} roughness={0.4} />
        </mesh>
        <mesh position={[0.55, 0, 0]} castShadow>
          <boxGeometry args={[0.36, 0.06, 0.36]} />
          <meshStandardMaterial color="#26262b" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh position={[0.55, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.34, 0.34]} />
          <meshStandardMaterial map={detailTex.ble} roughness={0.4} />
        </mesh>
        {[-1, 1].flatMap((s) =>
          [-0.15, -0.05, 0.05, 0.15].map((dx, i) => (
            <mesh key={`u${s}${i}`} position={[-0.55 + dx, -0.015, s * 0.235]}>
              <boxGeometry args={[0.05, 0.03, 0.03]} />
              <meshStandardMaterial color="#d8b25f" roughness={0.35} metalness={0.8} />
            </mesh>
          ))
        )}
        {[-1, 1].flatMap((s) =>
          [-0.1, 0, 0.1].map((dx, i) => (
            <mesh key={`b${s}${i}`} position={[0.55 + dx, -0.015, s * 0.195]}>
              <boxGeometry args={[0.05, 0.03, 0.03]} />
              <meshStandardMaterial color="#d8b25f" roughness={0.35} metalness={0.8} />
            </mesh>
          ))
        )}
        <Html position={[-2.3, 0.08, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={setLabel('uwb')}
            style={{
              whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, color: '#1d1d1f',
              background: 'rgba(255,255,255,0.85)', padding: '3px 8px', borderRadius: 999,
              boxShadow: '0 1px 5px rgba(0,0,0,0.1)', opacity: 0, textAlign: 'center',
            }}
          >
            UWB chip
            <div style={{ fontWeight: 400, fontSize: 10, color: '#86868b' }}>Pinpoints exact direction & distance</div>
          </div>
        </Html>
        <Html position={[2.3, 0.08, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={setLabel('ble')}
            style={{
              whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, color: '#1d1d1f',
              background: 'rgba(255,255,255,0.85)', padding: '3px 8px', borderRadius: 999,
              boxShadow: '0 1px 5px rgba(0,0,0,0.1)', opacity: 0, textAlign: 'center',
            }}
          >
            BLE chip
            <div style={{ fontWeight: 400, fontSize: 10, color: '#86868b' }}>Connects to phones & the finder network</div>
          </div>
        </Html>
      </group>

      {/* 4 — antenna trace near the PCB edge, with feed pads */}
      <group ref={setLayer('antenna')}>
        <mesh rotation={[-Math.PI / 2, 0, 0.4]}>
          <torusGeometry args={[R - 0.28, 0.028, 8, 96, Math.PI * 1.65]} />
          <meshStandardMaterial color="#c47f3a" roughness={0.35} metalness={0.75} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0.4]} position={[0, -0.005, 0]}>
          <torusGeometry args={[R - 0.42, 0.02, 8, 96, Math.PI * 1.3]} />
          <meshStandardMaterial color="#c47f3a" roughness={0.35} metalness={0.75} />
        </mesh>
        <mesh position={[R - 0.45, 0, 0.35]}>
          <boxGeometry args={[0.3, 0.03, 0.05]} />
          <meshStandardMaterial color="#c47f3a" roughness={0.35} metalness={0.75} />
        </mesh>
        {[0.42, 0.28].map((dz, i) => (
          <mesh key={i} position={[R - 0.32, 0, dz]}>
            <boxGeometry args={[0.09, 0.035, 0.09]} />
            <meshStandardMaterial color="#d8b25f" roughness={0.3} metalness={0.85} />
          </mesh>
        ))}
        {layerLabel('antenna', 'Antenna trace', -2.55, 'Sends & receives the locator signal')}
      </group>

      {/* 5 — coin-cell battery (thickest layer), engraved top + negative bottom */}
      <group ref={setLayer('battery')}>
        <mesh castShadow>
          <cylinderGeometry args={[1.0, 1.0, 0.18, 64]} />
          <meshStandardMaterial color="#d3d7dc" roughness={0.35} metalness={0.55} />
        </mesh>
        <mesh position={[0, 0.091, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.82, 0.98, 64]} />
          <meshStandardMaterial color="#a9aeb6" roughness={0.35} metalness={0.55} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.0915, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.8, 64]} />
          <meshStandardMaterial map={detailTex.battery} roughness={0.35} metalness={0.4} />
        </mesh>
        <mesh position={[0, -0.093, 0]}>
          <cylinderGeometry args={[0.86, 0.86, 0.012, 64]} />
          <meshStandardMaterial color="#7d838c" roughness={0.45} metalness={0.5} />
        </mesh>
        {layerLabel('battery', 'Coin-cell battery', 2.55, 'Powers the tag for ~1 year')}
      </group>

      {/* 6 — outer plastic shell: a lid that wraps down over the stack and
             fully seals shut, so the closed sticker shows only the crest */}
      <group ref={setLayer('shell')}>
        {/* top cap */}
        <mesh castShadow>
          <cylinderGeometry args={[R + 0.02, R + 0.02, 0.06, 64]} />
          <meshStandardMaterial color="#f4f4f2" roughness={0.85} />
        </mesh>
        {/* side wall that closes over the internal layers */}
        <mesh position={[0, -0.17, 0]} castShadow>
          <cylinderGeometry args={[R + 0.02, R + 0.02, 0.3, 64, 1, true]} />
          <meshStandardMaterial color="#f1f1ef" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
        {/* printed crest on the cap */}
        <mesh position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[R - 0.16, 64]} />
          <meshStandardMaterial map={pennTex} roughness={0.75} transparent />
        </mesh>
        {layerLabel('shell', 'Sealed outer shell', 2.7, 'Seals out water & dust')}
      </group>
    </group>
  )
}

/* ---------------- Room: a warm dollhouse-corner bedroom ---------------- */

function Room() {
  return (
    <group>
      {/* floor — warm oak */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[17, 13]} />
        <meshStandardMaterial color="#c79a63" roughness={0.85} />
      </mesh>
      {/* subtle plank seams */}
      {[-4, -2, 0, 2, 4].map((z) => (
        <mesh key={z} position={[0, 0.005, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[17, 0.03]} />
          <meshBasicMaterial color="#b0834f" transparent opacity={0.5} />
        </mesh>
      ))}

      {/* back + left walls — warm plaster */}
      <mesh position={[0, 3, -5.2]} receiveShadow>
        <planeGeometry args={[17, 6.4]} />
        <meshStandardMaterial color="#efe7da" roughness={1} />
      </mesh>
      <mesh position={[-7.4, 3, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[13, 6.4]} />
        <meshStandardMaterial color="#e7ddcd" roughness={1} />
      </mesh>
      {/* baseboards */}
      <mesh position={[0, 0.12, -5.16]}>
        <boxGeometry args={[17, 0.24, 0.06]} />
        <meshStandardMaterial color="#f6f1e9" roughness={0.9} />
      </mesh>
      <mesh position={[-7.36, 0.12, 0]}>
        <boxGeometry args={[0.06, 0.24, 13]} />
        <meshStandardMaterial color="#f6f1e9" roughness={0.9} />
      </mesh>

      {/* a framed window on the back wall for warmth + light motivation */}
      <group position={[-2.3, 3.4, -5.14]}>
        <mesh>
          <boxGeometry args={[2.6, 2.2, 0.08]} />
          <meshStandardMaterial color="#f6f1e9" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[2.3, 1.9]} />
          <meshStandardMaterial color="#cfe3ee" emissive="#e9f2f6" emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <boxGeometry args={[0.05, 1.9, 0.03]} />
          <meshStandardMaterial color="#f6f1e9" />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <boxGeometry args={[2.3, 0.05, 0.03]} />
          <meshStandardMaterial color="#f6f1e9" />
        </mesh>
      </group>

      {/* rug */}
      <mesh position={[-0.4, 0.02, 0.6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[5.4, 4.4]} />
        <meshStandardMaterial color="#e0d7c5" roughness={0.95} />
      </mesh>
      <mesh position={[-0.4, 0.025, 0.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.35, 2.5, 4, 1]} />
        <meshBasicMaterial color="#c9bda3" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      <Bed />
      <Desk />
      <Nightstand />
    </group>
  )
}

function Bed() {
  // headboard against the back wall (−z), foot toward the room (+z)
  return (
    <group position={[-4.6, 0, -2.4]}>
      {/* frame / box spring */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[3, 0.55, 4.5]} />
        <meshStandardMaterial color="#5f4130" roughness={0.7} />
      </mesh>
      {/* mattress / duvet */}
      <RoundedBox args={[2.9, 0.5, 4.4]} radius={0.12} smoothness={4} position={[0, 0.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#f4f1ea" roughness={0.9} />
      </RoundedBox>
      {/* headboard */}
      <mesh position={[0, 0.75, -2.3]} castShadow receiveShadow>
        <boxGeometry args={[3, 1.5, 0.16]} />
        <meshStandardMaterial color="#5f4130" roughness={0.7} />
      </mesh>
      {/* pillows */}
      <RoundedBox args={[1.2, 0.28, 0.72]} radius={0.13} smoothness={4} position={[-0.65, 1.12, -1.7]} castShadow>
        <meshStandardMaterial color="#fbfaf6" roughness={0.95} />
      </RoundedBox>
      <RoundedBox args={[1.2, 0.28, 0.72]} radius={0.13} smoothness={4} position={[0.65, 1.12, -1.7]} castShadow>
        <meshStandardMaterial color="#fbfaf6" roughness={0.95} />
      </RoundedBox>
      {/* folded navy throw at the foot */}
      <RoundedBox args={[2.9, 0.16, 1.1]} radius={0.06} smoothness={4} position={[0, 1.03, 1.5]} castShadow>
        <meshStandardMaterial color="#26324f" roughness={0.85} />
      </RoundedBox>
    </group>
  )
}

function Desk() {
  const legs = [
    [-1.6, -0.7],
    [1.6, -0.7],
    [-1.6, 0.7],
    [1.6, 0.7],
  ]
  return (
    <group position={[3.6, 0, -3.4]}>
      {/* top — light oak */}
      <RoundedBox args={[3.6, 0.12, 1.8]} radius={0.03} smoothness={4} position={[0, 1.35, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#d9bb8b" roughness={0.6} />
      </RoundedBox>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.675, z]} castShadow>
          <boxGeometry args={[0.14, 1.35, 0.14]} />
          <meshStandardMaterial color="#2b2b2e" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

function Nightstand() {
  return (
    <group position={[-1.9, 0, -3.9]}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 1.1, 0.95]} />
        <meshStandardMaterial color="#6b4a34" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.55, 0.49]}>
        <boxGeometry args={[0.9, 0.9, 0.02]} />
        <meshStandardMaterial color="#7a5540" roughness={0.6} />
      </mesh>
      {/* a small warm lamp */}
      <mesh position={[0, 1.18, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 0.25, 12]} />
        <meshStandardMaterial color="#b9832f" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.36, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.28, 0.28, 20]} />
        <meshStandardMaterial color="#f0e2c4" emissive="#f6e6bd" emissiveIntensity={0.6} roughness={0.7} />
      </mesh>
    </group>
  )
}

/* ---------------- Scene ---------------- */

// reposition the camera when switching modes (OrbitControls takes over after)
function CameraRig({ mode }) {
  const { camera } = useThree()
  useEffect(() => {
    if (mode === 'inside') camera.position.set(0.5, 3.6, 9.5)
    else camera.position.set(0.6, 8.6, 12.6) // look down into the room corner
  }, [mode, camera])
  return null
}

function Scene({ mode, laptopTarget, stickerWorldPos, hintRef, spotNameRef, closing, onExplodedClosed }) {
  const inside = mode === 'inside'
  return (
    <>
      <color attach="background" args={[inside ? '#f2f3f5' : '#e9dfce']} />

      {/* warm key light (window / lamp side), cool fill, gentle back */}
      <ambientLight intensity={inside ? 0.65 : 0.5} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.45}
        color={inside ? '#ffffff' : '#fff2e0'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[-6, 5, 2]} intensity={0.4} color="#dce6ff" />
      <directionalLight position={[-3, 6, -8]} intensity={0.35} color="#fff2e0" />
      <CameraRig mode={mode} />

      {inside ? (
        <>
          <ExplodedSticker closing={closing} onClosed={onExplodedClosed} />
          <ContactShadows position={[0, -0.001, 0]} opacity={0.38} scale={30} blur={2.6} far={5} resolution={1024} color="#1a1a1a" />
        </>
      ) : (
        <>
          <Room />
          <LaptopWithSticker mode={mode} targetRef={laptopTarget} worldPosRef={stickerWorldPos} />
          <FinderPuck mode={mode} stickerWorldPos={stickerWorldPos} hintRef={hintRef} spotNameRef={spotNameRef} />
          {mode === 'seek' && <SignalDots stickerWorldPos={stickerWorldPos} />}
        </>
      )}

      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={22}
        maxPolarAngle={Math.PI / 2.1}
        target={inside ? [0, 2.3, 0] : [-0.2, 1.1, -2]}
      />
    </>
  )
}

/* ---------------- Root ---------------- */

const buttonStyle = (primary) => ({
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  padding: '12px 26px',
  borderRadius: 999,
  border: 'none',
  cursor: 'pointer',
  color: primary ? '#fff' : '#1d1d1f',
  background: primary ? '#0071e3' : 'rgba(255,255,255,0.85)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  backdropFilter: 'blur(8px)',
  transition: 'background 0.25s, color 0.25s',
})

export default function FinderDemo() {
  const [mode, setMode] = useState('idle') // 'idle' | 'seek' | 'inside'
  const [closing, setClosing] = useState(false) // exploded view is sealing before going home
  const laptopTarget = useRef([...LAPTOP_HOME])
  const stickerWorldPos = useRef(new THREE.Vector3(...LAPTOP_HOME))
  const hintRef = useRef()
  const spotNameRef = useRef(SPOTS[0].name)
  const spotIndex = useRef(0)

  // while seeking, the laptop wanders between real spots (bed → desk → …)
  useEffect(() => {
    if (mode !== 'seek') return
    const move = () => {
      spotIndex.current = nextSpotIndex(spotIndex.current)
      const spot = SPOTS[spotIndex.current]
      laptopTarget.current = spot.pos
      spotNameRef.current = spot.name
    }
    move()
    const id = setInterval(move, 3200)
    return () => clearInterval(id)
  }, [mode])

  const goIdle = () => {
    laptopTarget.current = [...LAPTOP_HOME]
    stickerWorldPos.current.set(...LAPTOP_HOME)
    spotIndex.current = 0
    spotNameRef.current = SPOTS[0].name
    setMode('idle')
  }

  const enterInside = () => {
    setClosing(false)
    setMode('inside')
  }

  // Back from the exploded view: seal the sticker first, then return home
  const beginClose = () => setClosing(true)
  const finishClose = () => {
    setClosing(false)
    goIdle()
  }

  const subtitle =
    mode === 'inside'
      ? 'Inside the sticker — magnified view, ~3 mm thin in real life'
      : mode === 'seek'
      ? 'Left it somewhere? The Finder points across the room.'
      : 'Stick it on your laptop. The Finder always knows where it is.'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '100vh' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0.6, 8.6, 12.6], fov: 44 }}>
        <Scene
          mode={mode}
          laptopTarget={laptopTarget}
          stickerWorldPos={stickerWorldPos}
          hintRef={hintRef}
          spotNameRef={spotNameRef}
          closing={closing}
          onExplodedClosed={finishClose}
        />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 28,
          left: 0,
          right: 0,
          textAlign: 'center',
          pointerEvents: 'none',
          color: '#1d1d1f',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Never lose it again.</div>
        <div style={{ fontSize: 13, color: '#86868b', marginTop: 4 }}>{subtitle}</div>
      </div>

      <div style={{ position: 'absolute', bottom: 32, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12 }}>
        {mode === 'idle' && (
          <>
            <button onClick={() => setMode('seek')} style={buttonStyle(true)}>
              Show how it works
            </button>
            <button onClick={enterInside} style={buttonStyle(false)}>
              What’s inside the sticker
            </button>
          </>
        )}
        {mode === 'seek' && (
          <button onClick={goIdle} style={buttonStyle(false)}>
            Reset
          </button>
        )}
        {mode === 'inside' && (
          <button
            onClick={beginClose}
            disabled={closing}
            style={{ ...buttonStyle(false), opacity: closing ? 0.6 : 1, cursor: closing ? 'default' : 'pointer' }}
          >
            {closing ? 'Closing…' : 'Back'}
          </button>
        )}
      </div>

      <div
        ref={hintRef}
        style={{
          position: 'absolute',
          bottom: 84,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 12,
          color: '#86868b',
          pointerEvents: 'none',
          visibility: mode === 'seek' ? 'visible' : 'hidden',
        }}
      >
        Item this way
      </div>
    </div>
  )
}
