'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export interface GlobeMarker {
  lat: number
  lng: number
  label: string
  src?: string
}

interface GlobeConfig {
  atmosphereColor?: string
  atmosphereIntensity?: number
  bumpScale?: number
  autoRotateSpeed?: number
}

interface Props {
  markers?: GlobeMarker[]
  config?: GlobeConfig
  onMarkerClick?: (marker: GlobeMarker) => void
  onMarkerHover?: (marker: GlobeMarker | null) => void
}

const VERT_ATM = /* glsl */`
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRAG_ATM = /* glsl */`
  varying vec3 vNormal;
  uniform vec3 uColor;
  uniform float uIntensity;
  void main() {
    float d = dot(vNormal, vec3(0.0, 0.0, 1.0));
    float power = pow(max(0.0, 0.72 - d), max(1.0, uIntensity * 0.09));
    gl_FragColor = vec4(uColor, power);
  }
`

function toPos(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat) * Math.PI / 180
  const theta = (lng + 180) * Math.PI / 180
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  )
}

const CDN = 'https://unpkg.com/three-globe/example/img'

// Reusable materials for all markers
let _markerMats: {
  dot:   THREE.MeshBasicMaterial
  ring:  THREE.MeshBasicMaterial
  glow:  THREE.MeshBasicMaterial
  hit:   THREE.MeshBasicMaterial
} | null = null

function getMarkerMats() {
  if (!_markerMats) {
    _markerMats = {
      dot:  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      ring: new THREE.MeshBasicMaterial({ color: 0xff2828, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.30, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      hit:  new THREE.MeshBasicMaterial({ visible: false }),
    }
  }
  return _markerMats
}

function buildMarker(m: GlobeMarker): { group: THREE.Group; hitMesh: THREE.Mesh } {
  const pos    = toPos(m.lat, m.lng, 1.022)
  const normal = pos.clone().normalize()
  const mats   = getMarkerMats()

  const group = new THREE.Group()
  group.position.copy(pos)
  // Rotate group so local +Z points radially outward — all children lie flat on the surface
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)

  // White filled dot at center
  group.add(new THREE.Mesh(new THREE.CircleGeometry(0.019, 32), mats.dot))

  // Red ring
  group.add(new THREE.Mesh(new THREE.RingGeometry(0.026, 0.038, 48), mats.ring))

  // Outer glow ring (additive, fades out)
  group.add(new THREE.Mesh(new THREE.RingGeometry(0.040, 0.062, 48), mats.glow))

  // Invisible hit sphere for raycasting (visible:false is ignored by raycaster)
  const hitMesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), mats.hit)
  hitMesh.userData.marker = m
  group.add(hitMesh)

  return { group, hitMesh }
}

export function Globe3D({
  markers = [],
  config = {},
  onMarkerClick,
  onMarkerHover,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const threeRef = useRef({
    renderer:     null as THREE.WebGLRenderer | null,
    camera:       null as THREE.PerspectiveCamera | null,
    earth:        null as THREE.Mesh | null,
    hitMeshes:    [] as THREE.Mesh[],
    markerGroups: [] as Array<{ group: THREE.Group; marker: GlobeMarker }>,
    raycaster:    new THREE.Raycaster(),
    mouse:        new THREE.Vector2(),
    rafId:        null as number | null,
    // rotation state
    rotY:         0,
    tiltX:        0.22,
    // drag
    isDragging:   false,
    prevMouse:    { x: 0, y: 0 },
    // momentum
    velocity:     0,
    isCoasting:   false,
  })
  const [tooltip, setTooltip]           = useState<{ label: string; x: number; y: number } | null>(null)
  const [visibleLabels, setVisibleLabels] = useState<Array<{ label: string; x: number; y: number }>>([])
  const setVisibleLabelsRef = useRef(setVisibleLabels)
  setVisibleLabelsRef.current = setVisibleLabels

  const {
    atmosphereColor     = '#4da6ff',
    atmosphereIntensity = 20,
    bumpScale           = 5,
    autoRotateSpeed     = 0.2,
  } = config

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const t = threeRef.current

    const w = mount.clientWidth  || 400
    const h = mount.clientHeight || 400

    // ── Renderer ─────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    mount.appendChild(renderer.domElement)
    t.renderer = renderer

    // ── Scene + Camera ───────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    // Camera at z=3.0: FOV half-width = tan(22.5°)*3.0 = 1.24 > atmosphere radius 1.1
    // This ensures the globe never gets clipped at the sides
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
    camera.position.z = 3.0
    t.camera = camera

    // ── Lighting — kept dim for a dark, moody look ───────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.28))
    const sun = new THREE.DirectionalLight(0xffffff, 1.1)
    sun.position.set(5, 3, 5)
    scene.add(sun)

    // ── Earth ────────────────────────────────────────────────────────────────
    const loader   = new THREE.TextureLoader()
    const earthGeo = new THREE.SphereGeometry(1, 64, 64)
    const earthMat = new THREE.MeshPhongMaterial({
      map:         loader.load(`${CDN}/earth-blue-marble.jpg`),
      bumpMap:     loader.load(`${CDN}/earth-topology.png`),
      bumpScale:   bumpScale * 0.0015,
      specularMap: loader.load(`${CDN}/earth-water.png`),
      specular:    new THREE.Color(0x111111),
      shininess:   20,
    })
    const earth = new THREE.Mesh(earthGeo, earthMat)
    earth.rotation.x = t.tiltX
    earth.rotation.y = t.rotY
    scene.add(earth)
    t.earth = earth

    // ── Atmosphere ───────────────────────────────────────────────────────────
    const atmC   = new THREE.Color(atmosphereColor)
    const atmGeo = new THREE.SphereGeometry(1.1, 48, 48)
    const atmMat = new THREE.ShaderMaterial({
      vertexShader:   VERT_ATM,
      fragmentShader: FRAG_ATM,
      uniforms: {
        uColor:     { value: new THREE.Vector3(atmC.r, atmC.g, atmC.b) },
        uIntensity: { value: atmosphereIntensity },
      },
      blending:    THREE.AdditiveBlending,
      side:        THREE.BackSide,
      transparent: true,
      depthWrite:  false,
    })
    scene.add(new THREE.Mesh(atmGeo, atmMat))

    // ── Markers — white dot + red ring + outer glow, flat on surface ─────────
    const hitMeshes:    THREE.Mesh[] = []
    const markerGroups: Array<{ group: THREE.Group; marker: GlobeMarker }> = []
    for (const m of markers) {
      const { group, hitMesh } = buildMarker(m)
      earth.add(group)
      hitMeshes.push(hitMesh)
      markerGroups.push({ group, marker: m })
    }
    t.hitMeshes    = hitMeshes
    t.markerGroups = markerGroups

    // ── Animation loop ───────────────────────────────────────────────────────
    // Reusable vectors — allocated once, mutated each frame to avoid GC pressure
    const _wp  = new THREE.Vector3()
    const _ndc = new THREE.Vector3()

    function animate() {
      t.rafId = requestAnimationFrame(animate)

      if (t.isDragging) {
        // rotation applied directly in pointer handler
      } else if (t.isCoasting) {
        t.velocity *= 0.93
        if (Math.abs(t.velocity) < 0.00008) {
          t.isCoasting = false
          t.velocity   = 0
        } else {
          t.rotY += t.velocity
          earth.rotation.y = t.rotY
        }
      } else {
        t.rotY += autoRotateSpeed * 0.003
        earth.rotation.y = t.rotY
      }

      renderer.render(scene, camera)

      if (!mount) return

      // Project all markers and expose the 3 most camera-facing ones as labels
      const w2 = mount.clientWidth  / 2
      const h2 = mount.clientHeight / 2
      const scored = t.markerGroups.map(({ group, marker }) => {
        group.getWorldPosition(_wp)
        const facing = _wp.z          // camera is at z=3 → positive Z = facing viewer
        _ndc.copy(_wp).project(camera)
        return {
          label:  marker.label,
          x:      (_ndc.x  + 1) * w2,
          y:      (-_ndc.y + 1) * h2,
          facing,
        }
      })
      const top3 = scored
        .filter(p => p.facing > 0.15) // only front hemisphere, with a small margin
        .sort((a, b) => b.facing - a.facing)
        .slice(0, 3)
        .map(({ label, x, y }) => ({ label, x, y }))
      setVisibleLabelsRef.current(top3)
    }
    animate()

    // ── Resize ───────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth
      const nh = mount.clientHeight
      if (!nw || !nh) return
      renderer.setSize(nw, nh)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    return () => {
      ro.disconnect()
      if (t.rafId) cancelAnimationFrame(t.rafId)
      renderer.dispose()
      earthGeo.dispose()
      earthMat.dispose()
      atmGeo.dispose()
      atmMat.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Pointer events ──────────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const t = threeRef.current
    e.currentTarget.setPointerCapture(e.pointerId)
    t.isDragging  = true
    t.isCoasting  = false
    t.velocity    = 0
    t.prevMouse   = { x: e.clientX, y: e.clientY }
    e.currentTarget.style.cursor = 'grabbing'
    setTooltip(null)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const t     = threeRef.current
    const mount = mountRef.current
    if (!mount || !t.camera || !t.earth) return

    if (t.isDragging) {
      const dx = e.clientX - t.prevMouse.x
      const dy = e.clientY - t.prevMouse.y

      t.rotY   += dx * 0.009
      t.tiltX   = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, t.tiltX + dy * 0.009))
      t.earth.rotation.y = t.rotY
      t.earth.rotation.x = t.tiltX

      // Track last-frame velocity for momentum
      t.velocity  = dx * 0.009
      t.prevMouse = { x: e.clientX, y: e.clientY }
      setTooltip(null)
      return
    }

    // Hover: raycast against invisible hit spheres
    const rect   = mount.getBoundingClientRect()
    t.mouse.x    =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    t.mouse.y    = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    t.raycaster.setFromCamera(t.mouse, t.camera)
    const hits   = t.raycaster.intersectObjects(t.hitMeshes)
    if (hits.length > 0) {
      const marker = hits[0].object.userData.marker as GlobeMarker
      setTooltip({ label: marker.label, x: e.clientX - rect.left, y: e.clientY - rect.top })
      onMarkerHover?.(marker)
    } else {
      setTooltip(null)
      onMarkerHover?.(null)
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const t = threeRef.current
    t.isDragging = false
    // Start coast only if there's meaningful velocity
    t.isCoasting = Math.abs(t.velocity) > 0.0005
    e.currentTarget.style.cursor = 'grab'
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const t     = threeRef.current
    const mount = mountRef.current
    if (!mount || !t.camera) return
    const rect  = mount.getBoundingClientRect()
    t.mouse.x   =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    t.mouse.y   = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    t.raycaster.setFromCamera(t.mouse, t.camera)
    const hits  = t.raycaster.intersectObjects(t.hitMeshes)
    if (hits.length > 0) {
      onMarkerClick?.(hits[0].object.userData.marker as GlobeMarker)
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setTooltip(null)}
        onClick={onClick}
      />
      {/* Always-visible labels for the 3 most camera-facing markers */}
      {visibleLabels.map(lbl => (
        <div
          key={lbl.label}
          style={{
            position:      'absolute',
            left:          lbl.x,
            top:           lbl.y - 36,
            transform:     'translateX(-50%)',
            background:    'rgba(255,255,255,0.92)',
            border:        '1px solid rgba(221,213,197,0.7)',
            borderRadius:  '6px',
            padding:       '2px 9px',
            fontSize:      '11px',
            fontWeight:    500,
            color:         '#1B2E1A',
            pointerEvents: 'none',
            whiteSpace:    'nowrap',
            boxShadow:     '0 2px 8px rgba(0,0,0,0.14)',
            zIndex:        9,
          }}
        >
          {lbl.label}
        </div>
      ))}

      {tooltip && (
        <div
          style={{
            position:      'absolute',
            left:          tooltip.x + 14,
            top:           tooltip.y - 34,
            background:    'rgba(255,255,255,0.96)',
            border:        '1px solid rgba(221,213,197,0.8)',
            borderRadius:  '8px',
            padding:       '4px 12px',
            fontSize:      '12px',
            fontWeight:    600,
            color:         '#1B2E1A',
            pointerEvents: 'none',
            whiteSpace:    'nowrap',
            boxShadow:     '0 4px 14px rgba(0,0,0,0.18)',
            zIndex:        10,
          }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  )
}
