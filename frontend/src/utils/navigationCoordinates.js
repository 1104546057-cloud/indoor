const DIRECTION_TO_YAW = {
  east: 0,
  north: Math.PI / 2,
  west: Math.PI,
  south: -Math.PI / 2,
}

export function isPointInsideSlamCoverage(point, mapData) {
  const coverage = mapData?.slamMap?.coverage
  if (!point || !coverage) {
    return false
  }

  return (
    point.x >= coverage.x
    && point.x <= coverage.x + coverage.width
    && point.y >= coverage.y
    && point.y <= coverage.y + coverage.depth
  )
}

export function modelPointToSlamGoal(point, mapData) {
  const slamMap = mapData?.slamMap
  if (!point || !slamMap?.coverage || !slamMap?.imageSize || !slamMap?.yaml) {
    throw new Error('当前场景缺少 SLAM 坐标转换配置')
  }

  if (!isPointInsideSlamCoverage(point, mapData)) {
    throw new Error(`${point.id || point.name || '该点位'} 不在当前 SLAM 覆盖区内，不能直接下发导航`)
  }

  const { coverage, imageSize, yaml } = slamMap
  const [originX, originY] = yaml.origin
  const resolution = yaml.resolution
  const normalizedX = (point.x - coverage.x) / coverage.width
  const normalizedY = (point.y - coverage.y) / coverage.depth
  const pixelX = (slamMap.transform?.flipX ? 1 - normalizedX : normalizedX) * imageSize.width
  const pixelY = (slamMap.transform?.flipY ? 1 - normalizedY : normalizedY) * imageSize.height
  const mapX = originX + pixelX * resolution
  const mapY = originY + (imageSize.height - pixelY) * resolution

  const direction = point.direction ?? point.yaw

  return {
    frame_id: 'map',
    x: Number(mapX.toFixed(3)),
    y: Number(mapY.toFixed(3)),
    yaw: Number((DIRECTION_TO_YAW[direction] ?? 0).toFixed(3)),
    point_id: point.id,
    point_name: point.name,
    source: {
      model_x: point.x,
      model_y: point.y,
      pixel_x: Number(pixelX.toFixed(2)),
      pixel_y: Number(pixelY.toFixed(2)),
      resolution,
      origin: yaml.origin,
    },
  }
}

export function buildNavigationGoals(pointIds, mapData) {
  const pointById = Object.fromEntries((mapData?.inspectionPoints || []).map((point) => [point.id, point]))

  return pointIds.map((pointId) => {
    const point = pointById[pointId]
    if (!point) {
      throw new Error(`未找到巡检点：${pointId}`)
    }

    return modelPointToSlamGoal(point, mapData)
  })
}

export function buildNavigationGoalsFromPoints(points, mapData) {
  return (points || []).map((point) => modelPointToSlamGoal(point, mapData))
}
