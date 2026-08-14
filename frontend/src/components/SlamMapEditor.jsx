/* eslint-disable react/prop-types */

function mapPointToPixel(point, map) {
  const resolution = Number(map?.resolution)
  const width = Number(map?.width)
  const height = Number(map?.height)
  const originX = Number(map?.origin?.[0])
  const originY = Number(map?.origin?.[1])
  if (![resolution, width, height, originX, originY].every(Number.isFinite) || resolution <= 0) return null
  return {
    x: (Number(point.x) - originX) / resolution,
    y: height - ((Number(point.y) - originY) / resolution),
  }
}

function pixelToMapPoint(pixelX, pixelY, map) {
  const resolution = Number(map.resolution)
  const height = Number(map.height)
  const originX = Number(map.origin?.[0])
  const originY = Number(map.origin?.[1])
  return {
    x: originX + pixelX * resolution,
    y: originY + (height - pixelY) * resolution,
  }
}

export default function SlamMapEditor({ map, points = [], selectedPointIds = [], onPick, interactive = false }) {
  const width = Number(map?.width)
  const height = Number(map?.height)
  const ready = map?.previewUrl && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0

  const handlePointer = (event) => {
    if (!interactive || !ready || !onPick) return
    const svg = event.currentTarget
    const matrix = svg.getScreenCTM()
    if (!matrix) return
    const pointer = svg.createSVGPoint()
    pointer.x = event.clientX
    pointer.y = event.clientY
    const local = pointer.matrixTransform(matrix.inverse())
    if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return
    onPick(pixelToMapPoint(local.x, local.y, map))
  }

  if (!ready) {
    return <div className="slam-resource-empty">该地图缺少可用预览或尺寸信息</div>
  }

  const selected = new Set(selectedPointIds.map(String))
  return (
    <div className={`slam-resource-map ${interactive ? 'interactive' : ''}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role={interactive ? 'button' : 'img'}
        aria-label={interactive ? '点击地图选择巡检点坐标' : '巡检路线地图预览'}
        onPointerDown={handlePointer}
      >
        <image href={map.previewUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="none" />
        {points.map((point, index) => {
          const pixel = mapPointToPixel(point, map)
          if (!pixel) return null
          const pointId = String(point.id ?? point.pointCode ?? index)
          const isSelected = selected.size === 0 || selected.has(pointId)
          const markerRadius = Math.max(3, Math.min(width, height) * 0.014)
          const directionLength = markerRadius * 2.4
          const yaw = Number(point.yaw || 0)
          return (
            <g key={pointId} className={isSelected ? 'selected' : 'muted'}>
              <line
                x1={pixel.x}
                y1={pixel.y}
                x2={pixel.x + Math.cos(yaw) * directionLength}
                y2={pixel.y - Math.sin(yaw) * directionLength}
              />
              <circle cx={pixel.x} cy={pixel.y} r={markerRadius} />
              <text x={pixel.x} y={pixel.y + markerRadius * 0.35}>{index + 1}</text>
            </g>
          )
        })}
      </svg>
      {interactive ? <span>点击白色可通行区域读取导航坐标</span> : null}
    </div>
  )
}
