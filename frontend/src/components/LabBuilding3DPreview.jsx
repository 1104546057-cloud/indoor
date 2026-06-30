import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const SCALE = 0.001
const SLAM_OVERLAY_HEIGHT = 0.185

function createModelCalibration(mapData) {
  const calibration = mapData.slamMap?.modelCalibration
  const coverage = mapData.slamMap?.coverage
  if (calibration?.enabled === false) return null
  if (!calibration || !coverage) return null

  const target = calibration.target === 'coverage' ? coverage : calibration.target
  if (!target || !calibration.source) return null

  const source = calibration.source
  const scaleX = target.width / source.width
  const scaleY = target.depth / source.depth
  const idSet = new Set(calibration.objectIds || [])
  const prefixList = calibration.objectIdPrefixes || []
  const pointIdSet = new Set(calibration.inspectionPointIds || [])

  const hasObject = (id) => idSet.has(id) || prefixList.some((prefix) => id?.startsWith(prefix))
  const hasPoint = (id) => pointIdSet.has(id)
  const point = (x, y) => ({
    x: target.x + (x - source.x) * scaleX,
    y: target.y + (y - source.y) * scaleY,
  })

  return { hasObject, hasPoint, point, scaleX, scaleY }
}

function calibrateRect(item, calibration) {
  if (!calibration?.hasObject(item.id)) return item
  const topLeft = calibration.point(item.x, item.y)

  return {
    ...item,
    x: topLeft.x,
    y: topLeft.y,
    width: item.width * calibration.scaleX,
    depth: item.depth * calibration.scaleY,
  }
}

function calibrateLine(item, calibration) {
  if (!calibration?.hasObject(item.id)) return item
  const start = calibration.point(item.x1, item.y1)
  const end = calibration.point(item.x2, item.y2)

  return {
    ...item,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    width: item.width ? item.width * Math.min(calibration.scaleX, calibration.scaleY) : item.width,
    thickness: item.thickness ? item.thickness * Math.min(calibration.scaleX, calibration.scaleY) : item.thickness,
  }
}

function calibrateColumn(item, calibration) {
  if (!calibration?.hasObject(item.id)) return item
  const center = calibration.point(item.x, item.y)

  return {
    ...item,
    x: center.x,
    y: center.y,
    sizeX: item.sizeX * calibration.scaleX,
    sizeY: item.sizeY * calibration.scaleY,
  }
}

function calibratePoint(item, calibration) {
  if (!calibration?.hasPoint(item.id)) return item
  const center = calibration.point(item.x, item.y)

  return {
    ...item,
    x: center.x,
    y: center.y,
  }
}

function createWallMesh(segment, material) {
  const dx = (segment.x2 - segment.x1) * SCALE
  const dz = (segment.y2 - segment.y1) * SCALE
  const length = Math.hypot(dx, dz)
  const height = segment.height * SCALE
  const thickness = segment.thickness * SCALE
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, thickness),
    material,
  )

  mesh.position.set(
    ((segment.x1 + segment.x2) / 2) * SCALE,
    height / 2,
    ((segment.y1 + segment.y2) / 2) * SCALE,
  )
  mesh.rotation.y = -Math.atan2(dz, dx)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function LabBuilding3DPreview({ mapData, selectedPointIds = [], showPoints = true }) {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const width = mapData.size.width * SCALE
    const depth = mapData.size.height * SCALE
    const modelCalibration = createModelCalibration(mapData)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x03131f)
    scene.fog = new THREE.Fog(0x03131f, 90, 180)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260)
    camera.position.set(width * 0.58, 72, depth * 1.05)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(width / 2, 0, depth / 2)
    controls.minDistance = 28
    controls.maxDistance = 150
    controls.maxPolarAngle = Math.PI * 0.47

    scene.add(new THREE.HemisphereLight(0xbfefff, 0x06121a, 1.45))
    const keyLight = new THREE.DirectionalLight(0xe8fbff, 1.8)
    keyLight.position.set(width * 0.25, 70, depth * 0.18)
    keyLight.castShadow = true
    scene.add(keyLight)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0x092532, roughness: 0.82, metalness: 0.04 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(width / 2, 0, depth / 2)
    floor.receiveShadow = true
    scene.add(floor)

    const grid = new THREE.GridHelper(Math.max(width, depth) * 1.08, 42, 0x2b8498, 0x174354)
    grid.position.set(width / 2, 0.012, depth / 2)
    scene.add(grid)

    if (mapData.slamMap?.placement || mapData.slamMap?.coverage) {
      const placement = mapData.slamMap.placement || mapData.slamMap.coverage
      const coverageWidth = placement.width * SCALE
      const coverageDepth = placement.depth * SCALE
      const coverageCenterX = (placement.x + placement.width / 2) * SCALE
      const coverageCenterZ = (placement.y + placement.depth / 2) * SCALE

      const texture = new THREE.TextureLoader().load(mapData.slamMap.imageUrl)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
      if (mapData.slamMap.transform?.flipX) {
        texture.wrapS = THREE.RepeatWrapping
        texture.repeat.x = -1
        texture.offset.x = 1
      }
      if (mapData.slamMap.transform?.flipY) {
        texture.wrapT = THREE.RepeatWrapping
        texture.repeat.y = -1
        texture.offset.y = 1
      }

      const slamPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(coverageWidth, coverageDepth),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        }),
      )
      slamPlane.rotation.x = -Math.PI / 2
      slamPlane.position.set(coverageCenterX, SLAM_OVERLAY_HEIGHT, coverageCenterZ)
      scene.add(slamPlane)

      const coverageFrame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(coverageWidth, 0.08, coverageDepth)),
        new THREE.LineBasicMaterial({ color: 0x35f0bd, transparent: true, opacity: 0.86 }),
      )
      coverageFrame.position.set(coverageCenterX, SLAM_OVERLAY_HEIGHT + 0.04, coverageCenterZ)
      scene.add(coverageFrame)

      const uncoveredWidth = Math.max(0, mapData.size.width - placement.x - placement.width) * SCALE
      if (uncoveredWidth > 0) {
        const mask = new THREE.Mesh(
          new THREE.PlaneGeometry(uncoveredWidth, depth),
          new THREE.MeshBasicMaterial({
            color: 0x03131f,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
          }),
        )
        mask.rotation.x = -Math.PI / 2
        mask.position.set((placement.x + placement.width) * SCALE + uncoveredWidth / 2, SLAM_OVERLAY_HEIGHT + 0.01, depth / 2)
        scene.add(mask)
      }
    }

    const corridorMaterial = new THREE.MeshStandardMaterial({
      color: 0x17687a,
      emissive: 0x082c35,
      roughness: 0.62,
      metalness: 0.06,
      transparent: true,
      opacity: 0.94,
    })

    const hallMaterial = new THREE.MeshStandardMaterial({
      color: 0x234f61,
      emissive: 0x071f29,
      roughness: 0.72,
      metalness: 0.04,
      transparent: true,
      opacity: 0.92,
    })
    const hallEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x9edfea, transparent: true, opacity: 0.62 })
    mapData.halls?.map((hall) => calibrateRect(hall, modelCalibration)).forEach((hall) => {
      const elevation = hall.elevation * SCALE
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(hall.width * SCALE, 0.16, hall.depth * SCALE),
        hallMaterial,
      )
      slab.position.set(
        (hall.x + hall.width / 2) * SCALE,
        elevation + 0.08,
        (hall.y + hall.depth / 2) * SCALE,
      )
      slab.receiveShadow = true
      scene.add(slab)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), hallEdgeMaterial)
      edges.position.copy(slab.position)
      scene.add(edges)
    })

    const rampMaterial = new THREE.MeshStandardMaterial({ color: 0x36a8b5, roughness: 0.58, metalness: 0.05 })
    mapData.ramps?.map((ramp) => calibrateLine(ramp, modelCalibration)).forEach((ramp) => {
      const dx = (ramp.x2 - ramp.x1) * SCALE
      const dz = (ramp.y2 - ramp.y1) * SCALE
      const length = Math.hypot(dx, dz)
      const startElevation = ramp.startElevation * SCALE
      const endElevation = ramp.endElevation * SCALE
      const incline = Math.atan2(endElevation - startElevation, length)
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.1, ramp.width * SCALE),
        rampMaterial,
      )
      mesh.position.set(
        ((ramp.x1 + ramp.x2) / 2) * SCALE,
        (startElevation + endElevation) / 2 + 0.11,
        ((ramp.y1 + ramp.y2) / 2) * SCALE,
      )
      mesh.rotation.order = 'YXZ'
      mesh.rotation.y = -Math.atan2(dz, dx)
      mesh.rotation.z = incline
      mesh.receiveShadow = true
      scene.add(mesh)
    })

    const columnMaterial = new THREE.MeshStandardMaterial({
      color: 0xb2a487,
      roughness: 0.78,
      metalness: 0.02,
    })
    mapData.columns?.map((column) => calibrateColumn(column, modelCalibration)).forEach((column) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(column.sizeX * SCALE, column.height * SCALE, column.sizeY * SCALE),
        columnMaterial,
      )
      mesh.position.set(column.x * SCALE, column.height * SCALE / 2 + 0.16, column.y * SCALE)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), hallEdgeMaterial)
      edges.position.copy(mesh.position)
      scene.add(edges)
    })

    mapData.corridors?.map((segment) => calibrateLine(segment, modelCalibration)).forEach((segment) => {
      const dx = (segment.x2 - segment.x1) * SCALE
      const dz = (segment.y2 - segment.y1) * SCALE
      const length = Math.hypot(dx, dz) + segment.width * SCALE
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.16, segment.width * SCALE),
        corridorMaterial,
      )
      strip.position.set(
        ((segment.x1 + segment.x2) / 2) * SCALE,
        0.08,
        ((segment.y1 + segment.y2) / 2) * SCALE,
      )
      strip.rotation.y = -Math.atan2(dz, dx)
      strip.receiveShadow = true
      scene.add(strip)
    })

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f8390,
      roughness: 0.55,
      metalness: 0.08,
      transparent: true,
      opacity: 0.9,
    })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xaeeefa, transparent: true, opacity: 0.56 })

    mapData.walls.map((segment) => calibrateLine(segment, modelCalibration)).forEach((segment) => {
      const mesh = createWallMesh(segment, wallMaterial)
      scene.add(mesh)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMaterial)
      edges.position.copy(mesh.position)
      edges.rotation.copy(mesh.rotation)
      scene.add(edges)
    })

    const selectedPoints = showPoints
      ? mapData.inspectionPoints
        .map((point) => calibratePoint(point, modelCalibration))
        .filter((point) => selectedPointIds.includes(point.id))
      : []
    const routeGeometry = new THREE.BufferGeometry().setFromPoints(
      selectedPoints.map((point) => new THREE.Vector3(point.x * SCALE, 0.18, point.y * SCALE)),
    )
    if (selectedPoints.length > 1) {
      scene.add(new THREE.Line(routeGeometry, new THREE.LineBasicMaterial({ color: 0x35f0bd })))
    }

    const markerGeometry = new THREE.CylinderGeometry(0.38, 0.38, 0.16, 24)
    if (showPoints) mapData.inspectionPoints.map((point) => calibratePoint(point, modelCalibration)).forEach((point, index) => {
      const selected = selectedPointIds.includes(point.id)
      const marker = new THREE.Mesh(
        markerGeometry,
        new THREE.MeshBasicMaterial({ color: selected ? (index === 0 ? 0xffdf52 : 0x35f0bd) : 0x5f9fac }),
      )
      marker.position.set(point.x * SCALE, 0.14, point.y * SCALE)
      marker.scale.setScalar(selected ? 1.3 : 0.78)
      scene.add(marker)
    })

    const resize = () => {
      const rect = mount.getBoundingClientRect()
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / Math.max(1, rect.height)
      camera.updateProjectionMatrix()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()

    let frameId
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frameId)
      controls.dispose()
      renderer.dispose()
      scene.traverse((object) => {
        object.geometry?.dispose?.()
        if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose?.())
        else object.material?.dispose?.()
      })
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [mapData, selectedPointIds, showPoints])

  return (
    <div className="lab-building-3d-preview">
      <div ref={mountRef} className="lab-building-3d-canvas" />
      <div className="lab-model-scale">
        <span>{mapData.slamMap?.coverage?.label || '实验楼一层近似模型'}</span>
        <strong>{mapData.slamMap ? '左半区已对接 SLAM 图' : '走廊基准 4.05 m'}</strong>
        <small>{mapData.slamMap ? '右半区暂为未建图参考区' : '鼠标拖动旋转 / 滚轮缩放'}</small>
      </div>
    </div>
  )
}

export default LabBuilding3DPreview
