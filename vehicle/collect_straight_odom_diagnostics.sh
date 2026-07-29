#!/usr/bin/env bash
set -u

source /opt/ros/melodic/setup.bash
if [[ -f /home/nano1/indoor_patrol_ws/devel/setup.bash ]]; then
  source /home/nano1/indoor_patrol_ws/devel/setup.bash
fi

stamp="$(date +%Y%m%d_%H%M%S)"
output_dir="/home/nano1/odom_diag_${stamp}"
bag_file="${output_dir}/straight_test.bag"
driver_dir="/home/nano1/indoor_patrol_ws/src/dlrobot_robot"
driver_cpp="${driver_dir}/src/dlrobot_robot.cpp"
driver_header="${driver_dir}/include/dlrobot_robot.h"
driver_launch="${driver_dir}/launch/base_serial.launch"

mkdir -p "${output_dir}"
exec > >(tee "${output_dir}/summary.txt") 2>&1

echo "=== Straight odometry diagnostic ==="
echo "Output: ${output_dir}"
echo "This script only reads ROS topics and files. It does not publish velocity commands."
echo

echo "=== ROS nodes ==="
rosnode list

echo "=== Topic publishers/subscribers ==="
for topic in /cmd_vel /navigation/cmd_vel_raw /odom /imu /joint_states /tf; do
  echo "--- ${topic}"
  rostopic info "${topic}" || true
done

echo "=== dlrobot_robot node ==="
rosnode info /dlrobot_robot || true

echo "=== dlrobot_robot parameters ==="
rosparam get /dlrobot_robot || true

echo "=== Relevant ROS parameters ==="
rosparam list |
  grep -Ei 'wheel|separation|track|base_width|radius|multiplier|imu|odom' ||
  true

echo "=== One sample while stationary ==="
for topic in /cmd_vel /navigation/cmd_vel_raw /odom /imu /joint_states; do
  echo "--- ${topic}"
  timeout 4 rostopic echo -n 1 "${topic}" || true
done

echo "=== Driver source matches ==="
if [[ -f "${driver_cpp}" ]]; then
  grep -nE \
    'Robot_Pos|Robot_Vel|Receive_Data|angular_velocity|createQuaternion|odom_quat|Odometry|IMU|imu|wheel|encoder' \
    "${driver_cpp}" |
    tee "${output_dir}/driver_matches.txt" ||
    true
  cp "${driver_cpp}" "${output_dir}/dlrobot_robot.cpp"
else
  echo "Missing: ${driver_cpp}"
fi

if [[ -f "${driver_header}" ]]; then
  cp "${driver_header}" "${output_dir}/dlrobot_robot.h"
fi

if [[ -f "${driver_launch}" ]]; then
  cp "${driver_launch}" "${output_dir}/base_serial.launch"
fi

echo
echo "Prepare a safe, obstacle-free straight line."
echo "During recording perform only:"
echo "  1. Keep still for 10 seconds."
echo "  2. Drive straight forward about 0.5 m with angular.z = 0."
echo "  3. Stop for 10 seconds."
echo "  4. Drive straight backward to the start with angular.z = 0."
echo "  5. Stop for the remaining time."
echo
read -r -p "Press Enter to start a 75-second recording..."

topics=(/cmd_vel /navigation/cmd_vel_raw /odom /imu /joint_states /tf)
rosbag record -O "${bag_file}" "${topics[@]}" &
bag_pid=$!

echo "Recording started. Perform the straight forward/backward test now."
sleep 75

kill -INT "${bag_pid}" 2>/dev/null || true
wait "${bag_pid}" 2>/dev/null || true

echo "=== Bag information ==="
rosbag info "${bag_file}" | tee "${output_dir}/bag_info.txt"

echo "=== Exporting topic CSV files ==="
declare -A csv_topics=(
  [cmd_vel]="/cmd_vel"
  [navigation_cmd_vel_raw]="/navigation/cmd_vel_raw"
  [odom]="/odom"
  [imu]="/imu"
  [joint_states]="/joint_states"
)

for name in "${!csv_topics[@]}"; do
  rostopic echo -b "${bag_file}" -p "${csv_topics[$name]}" \
    > "${output_dir}/${name}.csv" 2> "${output_dir}/${name}.stderr.txt" ||
    true
done

archive="${output_dir}.tar.gz"
tar -czf "${archive}" -C /home/nano1 "$(basename "${output_dir}")"

echo
echo "Diagnostic collection complete."
echo "Archive: ${archive}"
echo "Copy this archive to the Windows computer and attach it to Codex."
