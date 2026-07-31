#!/usr/bin/env python
# coding=utf-8

"""Nano-side HTTP vehicle agent with ordered move_base route execution.

This file is kept in the desktop repository as the deployable source for:
  /home/nano1/indoor_patrol_ws/src/indoor_patrol_bringup/scripts/vehicle_agent.py

The Nano currently runs ROS Melodic and Python 3.6, so this module deliberately
avoids newer Python syntax.
"""

import json
import math
import threading
import time
import uuid

try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
    from urllib.parse import parse_qs, urlparse
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
    from SocketServer import ThreadingMixIn
    from urlparse import parse_qs, urlparse

import rospy
from geometry_msgs.msg import Twist
from std_msgs.msg import Float32

try:
    from std_srvs.srv import Empty
except ImportError:
    Empty = None

try:
    import actionlib
    from actionlib_msgs.msg import GoalStatus
    from move_base_msgs.msg import MoveBaseAction, MoveBaseGoal
except ImportError:
    actionlib = None
    GoalStatus = None
    MoveBaseAction = None
    MoveBaseGoal = None

try:
    from nav_msgs.msg import Odometry
except ImportError:
    Odometry = None

try:
    import tf
except ImportError:
    tf = None

try:
    from geometry_msgs.msg import PoseWithCovarianceStamped
except ImportError:
    PoseWithCovarianceStamped = None


def quaternion_from_yaw(yaw):
    half = float(yaw) * 0.5
    return {
        "x": 0.0,
        "y": 0.0,
        "z": math.sin(half),
        "w": math.cos(half),
    }


def yaw_from_quaternion(quaternion):
    x, y, z, w = [float(value) for value in quaternion]
    return math.atan2(
        2.0 * (w * z + x * y),
        1.0 - 2.0 * (y * y + z * z),
    )


def is_finite_number(value):
    return not math.isnan(value) and not math.isinf(value)


class VehicleController(object):
    """Manual controller plus a strict, ordered move_base route executor."""

    def __init__(self):
        self.lock = threading.RLock()
        self.linear_x = 0.0
        self.angular_z = 0.0
        self.acceleration = rospy.get_param("~default_acceleration", 0.4)
        self.last_command_time = 0.0
        self.command_timeout = rospy.get_param("~command_timeout", 0.6)
        self.max_linear_x = rospy.get_param("~max_linear_x", 0.5)
        self.max_angular_z = rospy.get_param("~max_angular_z", 1.0)
        self.publish_rate = rospy.get_param("~publish_rate", 20.0)
        self.move_base_wait_timeout = rospy.get_param("~move_base_wait_timeout", 2.0)
        self.route_goal_timeout = rospy.get_param("~route_goal_timeout", 180.0)
        self.route_arrival_pause = rospy.get_param("~route_arrival_pause", 0.5)
        self.clear_costmaps_before_route = rospy.get_param(
            "~clear_costmaps_before_route",
            True,
        )
        self.clear_costmaps_timeout = rospy.get_param(
            "~clear_costmaps_timeout",
            3.0,
        )
        self.costmap_reset_wait = rospy.get_param("~costmap_reset_wait", 2.0)
        self.map_frame = rospy.get_param("~map_frame", "map")
        self.base_frame = rospy.get_param("~base_frame", "base_link")
        self.pose_stale_timeout = rospy.get_param("~pose_stale_timeout", 2.0)
        self.max_covariance_x = rospy.get_param("~max_covariance_x", 0.5)
        self.max_covariance_y = rospy.get_param("~max_covariance_y", 0.5)
        self.max_covariance_yaw = rospy.get_param("~max_covariance_yaw", 0.8)
        self.voltage = None
        self.odom_linear_x = 0.0
        self.odom_angular_z = 0.0
        self.amcl_pose_stamp = None
        self.amcl_covariance = None
        self.tf_listener = tf.TransformListener() if tf is not None else None
        self.publisher = rospy.Publisher("/cmd_vel", Twist, queue_size=1)
        self.voltage_subscriber = rospy.Subscriber(
            "/PowerVoltage",
            Float32,
            self._voltage_callback,
        )
        if Odometry is not None:
            self.odom_subscriber = rospy.Subscriber(
                "/odom",
                Odometry,
                self._odom_callback,
            )
        if PoseWithCovarianceStamped is not None:
            self.amcl_pose_subscriber = rospy.Subscriber(
                "/amcl_pose",
                PoseWithCovarianceStamped,
                self._amcl_pose_callback,
            )

        self.navigation_available = (
            actionlib is not None
            and MoveBaseAction is not None
            and GoalStatus is not None
        )
        self.move_base_client = (
            actionlib.SimpleActionClient("move_base", MoveBaseAction)
            if self.navigation_available
            else None
        )
        self.clear_costmaps_client = (
            rospy.ServiceProxy("/move_base/clear_costmaps", Empty)
            if Empty is not None
            else None
        )
        self.navigation_state = self._idle_navigation_state()
        self.route_thread = None

    def _idle_navigation_state(self):
        return {
            "execution_id": None,
            "active": False,
            "mode": None,
            "state": "idle",
            "task_id": None,
            "point_id": None,
            "point_name": None,
            "route_index": 0,
            "route_total": 0,
            "reached_count": 0,
            "results": [],
            "last_status": "idle",
            "last_error": None,
            "started_at": None,
            "updated_at": time.time(),
            "completed_at": None,
        }

    def _navigation_snapshot_locked(self):
        snapshot = dict(self.navigation_state)
        snapshot["results"] = [
            dict(item)
            for item in self.navigation_state.get("results", [])
        ]
        return snapshot

    def _touch_navigation_locked(self):
        self.navigation_state["updated_at"] = time.time()

    def _prepare_route_costmaps(self, execution_id):
        """Clear stale obstacle cells and wait for fresh lidar observations.

        A 2D Pose Estimate changes map->odom without physically moving the
        robot.  A non-rolling global obstacle layer can therefore retain
        obstacle cells written using the old map pose.  Clearing immediately
        before a route removes those stale cells; the short wait lets the
        active laser source mark any obstacles that are still present.
        """
        if not self.clear_costmaps_before_route:
            return
        if self.clear_costmaps_client is None:
            rospy.logwarn("costmap reset skipped: std_srvs is unavailable")
            return

        with self.lock:
            if (
                self.navigation_state.get("execution_id") != execution_id
                or not self.navigation_state.get("active")
            ):
                return
            self.navigation_state.update({
                "state": "preparing",
                "last_status": "clearing_costmaps",
                "last_error": None,
            })
            self._touch_navigation_locked()

        try:
            rospy.wait_for_service(
                "/move_base/clear_costmaps",
                timeout=float(self.clear_costmaps_timeout),
            )
            self.clear_costmaps_client()
            rospy.sleep(max(0.0, float(self.costmap_reset_wait)))
            with self.lock:
                if self.navigation_state.get("execution_id") == execution_id:
                    self.navigation_state["last_status"] = "costmaps_ready"
                    self._touch_navigation_locked()
            rospy.loginfo(
                "route %s costmaps cleared; waited %.2fs for fresh scans",
                execution_id,
                float(self.costmap_reset_wait),
            )
        except Exception as error:
            # Keep the existing behavior when the optional service is not
            # available; move_base will still perform its normal recoveries.
            rospy.logwarn(
                "route %s could not clear costmaps before dispatch: %s",
                execution_id,
                error,
            )

    def _limit(self, value, limit):
        return max(-limit, min(limit, float(value)))

    def _voltage_callback(self, msg):
        with self.lock:
            self.voltage = float(msg.data)

    def _odom_callback(self, msg):
        with self.lock:
            self.odom_linear_x = float(msg.twist.twist.linear.x)
            self.odom_angular_z = float(msg.twist.twist.angular.z)

    def _amcl_pose_callback(self, msg):
        covariance = list(msg.pose.covariance)
        stamp = msg.header.stamp.to_sec()
        with self.lock:
            self.amcl_pose_stamp = stamp if stamp > 0 else time.time()
            self.amcl_covariance = {
                "x": float(covariance[0]),
                "y": float(covariance[7]),
                "yaw": float(covariance[35]),
            }

    def _map_pose_snapshot_locked(self):
        now = time.time()
        covariance = (
            dict(self.amcl_covariance)
            if self.amcl_covariance is not None
            else None
        )
        localization = {
            "valid": False,
            "tf_available": self.tf_listener is not None,
            "map_frame": self.map_frame,
            "base_frame": self.base_frame,
            "pose_age": None,
            "amcl_pose_age": (
                None
                if self.amcl_pose_stamp is None
                else max(0.0, now - self.amcl_pose_stamp)
            ),
            "covariance_x": covariance.get("x") if covariance else None,
            "covariance_y": covariance.get("y") if covariance else None,
            "covariance_yaw": covariance.get("yaw") if covariance else None,
            "last_error": None,
        }

        if self.tf_listener is None:
            localization["last_error"] = "python tf package is unavailable"
            return None, localization

        try:
            common_time = self.tf_listener.getLatestCommonTime(
                self.map_frame,
                self.base_frame,
            )
            translation, rotation = self.tf_listener.lookupTransform(
                self.map_frame,
                self.base_frame,
                rospy.Time(0),
            )
            stamp = common_time.to_sec()
            if stamp <= 0:
                stamp = now
            pose_age = max(0.0, now - stamp)
            yaw = yaw_from_quaternion(rotation)
            pose = {
                "frame_id": self.map_frame,
                "child_frame_id": self.base_frame,
                "stamp": stamp,
                "x": float(translation[0]),
                "y": float(translation[1]),
                "yaw": yaw,
                "position": {
                    "x": float(translation[0]),
                    "y": float(translation[1]),
                    "z": float(translation[2]),
                },
                "orientation": {
                    "x": float(rotation[0]),
                    "y": float(rotation[1]),
                    "z": float(rotation[2]),
                    "w": float(rotation[3]),
                },
            }
            covariance_valid = (
                covariance is None
                or (
                    covariance["x"] <= float(self.max_covariance_x)
                    and covariance["y"] <= float(self.max_covariance_y)
                    and covariance["yaw"] <= float(self.max_covariance_yaw)
                )
            )
            localization.update({
                "valid": (
                    pose_age <= float(self.pose_stale_timeout)
                    and covariance_valid
                ),
                "pose_age": pose_age,
            })
            if not covariance_valid:
                localization["last_error"] = "AMCL covariance is too large"
            elif pose_age > float(self.pose_stale_timeout):
                localization["last_error"] = "map pose is stale"
            return pose, localization
        except Exception as error:
            localization["last_error"] = str(error)
            return None, localization

    def _cancel_navigation_locked(self, reason="cancelled"):
        was_active = bool(self.navigation_state.get("active"))
        if self.move_base_client is not None:
            try:
                self.move_base_client.cancel_all_goals()
            except Exception as error:
                rospy.logwarn("failed to cancel move_base goals: %s", error)

        if was_active:
            current_index = int(self.navigation_state.get("route_index", 0)) - 1
            results = self.navigation_state.get("results", [])
            if 0 <= current_index < len(results):
                if results[current_index].get("state") == "moving":
                    results[current_index]["state"] = "cancelled"
                    results[current_index]["finished_at"] = time.time()

        self.navigation_state.update({
            "active": False,
            "state": reason,
            "last_status": reason,
            "completed_at": time.time(),
        })
        self._touch_navigation_locked()

    def set_command(self, linear_x, angular_z, acceleration=None):
        with self.lock:
            self._cancel_navigation_locked()
            self.linear_x = self._limit(linear_x, self.max_linear_x)
            self.angular_z = self._limit(angular_z, self.max_angular_z)
            if acceleration is not None:
                self.acceleration = max(0.0, float(acceleration))
            self.last_command_time = time.time()
            return self.status_locked()

    def stop(self):
        with self.lock:
            self._cancel_navigation_locked()
            self.linear_x = 0.0
            self.angular_z = 0.0
            self.last_command_time = time.time()
            return self.status_locked()

    def cancel_navigation_route(self, execution_id=None):
        with self.lock:
            current_id = self.navigation_state.get("execution_id")
            if execution_id and current_id and execution_id != current_id:
                raise ValueError("navigation execution not found")
            self._cancel_navigation_locked()
            self.linear_x = 0.0
            self.angular_z = 0.0
            self.last_command_time = time.time()
            return self._navigation_snapshot_locked()

    def status(self):
        with self.lock:
            return self.status_locked()

    def status_locked(self):
        now = time.time()
        is_stale = (now - self.last_command_time) > self.command_timeout
        pose, localization = self._map_pose_snapshot_locked()
        return {
            "online": True,
            "linear_x": self.linear_x,
            "angular_z": self.angular_z,
            "acceleration": self.acceleration,
            "publish_rate": self.publish_rate,
            "command_timeout": self.command_timeout,
            "last_command_age": (
                None
                if self.last_command_time == 0.0
                else now - self.last_command_time
            ),
            "command_stale": is_stale,
            "voltage": self.voltage,
            "odom_linear_x": self.odom_linear_x,
            "odom_angular_z": self.odom_angular_z,
            "pose": pose,
            "localization": localization,
            "navigation_available": self.navigation_available,
            "navigation": self._navigation_snapshot_locked(),
        }

    def navigation_route_status(self, execution_id=None):
        with self.lock:
            current_id = self.navigation_state.get("execution_id")
            if execution_id and current_id != execution_id:
                raise ValueError("navigation execution not found")
            return self._navigation_snapshot_locked()

    def _wait_for_move_base(self):
        if not self.navigation_available:
            raise RuntimeError("move_base action client is not available")
        timeout = rospy.Duration(float(self.move_base_wait_timeout))
        if not self.move_base_client.wait_for_server(timeout):
            raise RuntimeError("move_base action server is not available")

    def _build_move_base_goal(self, data):
        frame_id = data.get("frame_id", "map")
        if frame_id != "map":
            raise ValueError("navigation goal frame_id must be map")

        x = float(data["x"])
        y = float(data["y"])
        yaw = float(data.get("yaw", 0.0))
        if not all(is_finite_number(value) for value in (x, y, yaw)):
            raise ValueError("navigation goal contains non-finite coordinates")

        goal = MoveBaseGoal()
        goal.target_pose.header.frame_id = frame_id
        goal.target_pose.header.stamp = rospy.Time.now()
        goal.target_pose.pose.position.x = x
        goal.target_pose.pose.position.y = y
        goal.target_pose.pose.position.z = 0.0
        quat = quaternion_from_yaw(yaw)
        goal.target_pose.pose.orientation.x = quat["x"]
        goal.target_pose.pose.orientation.y = quat["y"]
        goal.target_pose.pose.orientation.z = quat["z"]
        goal.target_pose.pose.orientation.w = quat["w"]
        return goal

    def send_navigation_goal(self, data):
        self._wait_for_move_base()
        goal = self._build_move_base_goal(data)
        execution_id = "goal-" + uuid.uuid4().hex
        now = time.time()
        with self.lock:
            if self.navigation_state.get("active"):
                raise RuntimeError("a navigation execution is already running")
            self.linear_x = 0.0
            self.angular_z = 0.0
            self.navigation_state = {
                "execution_id": execution_id,
                "active": True,
                "mode": "goal",
                "state": "moving",
                "task_id": data.get("task_id"),
                "point_id": data.get("point_id"),
                "point_name": data.get("point_name"),
                "route_index": int(data.get("route_index", 1)),
                "route_total": int(data.get("route_total", 1)),
                "reached_count": 0,
                "results": [],
                "last_status": "sent",
                "last_error": None,
                "started_at": now,
                "updated_at": now,
                "completed_at": None,
            }
        self.move_base_client.send_goal(goal)
        return self.status()

    def send_navigation_route(self, data):
        goals = data.get("goals") or []
        if not goals:
            raise ValueError("navigation route requires at least one goal")
        if len(goals) > 100:
            raise ValueError("navigation route supports at most 100 goals")

        # Build every goal before accepting the route so malformed coordinates
        # cannot fail halfway through an otherwise valid execution.
        for goal_data in goals:
            self._build_move_base_goal(goal_data)
        self._wait_for_move_base()

        execution_id = "route-" + uuid.uuid4().hex
        now = time.time()
        with self.lock:
            if self.route_thread is not None and self.route_thread.is_alive():
                raise RuntimeError("a navigation route is already running")
            if self.navigation_state.get("active"):
                raise RuntimeError("a navigation execution is already running")

            self.linear_x = 0.0
            self.angular_z = 0.0
            self.navigation_state = {
                "execution_id": execution_id,
                "active": True,
                "mode": "route",
                "state": "queued",
                "task_id": data.get("task_id"),
                "point_id": goals[0].get("point_id"),
                "point_name": goals[0].get("point_name"),
                "route_index": 0,
                "route_total": len(goals),
                "reached_count": 0,
                "results": [
                    {
                        "index": index + 1,
                        "point_id": goal.get("point_id"),
                        "point_name": goal.get("point_name"),
                        "frame_id": goal.get("frame_id", "map"),
                        "x": float(goal.get("x")),
                        "y": float(goal.get("y")),
                        "yaw": float(goal.get("yaw", 0.0)),
                        "source": goal.get("source"),
                        "state": "pending",
                        "started_at": None,
                        "finished_at": None,
                        "move_base_state": None,
                    }
                    for index, goal in enumerate(goals)
                ],
                "last_status": "route_accepted",
                "last_error": None,
                "started_at": now,
                "updated_at": now,
                "completed_at": None,
            }

            self.route_thread = threading.Thread(
                target=self._run_route,
                args=(execution_id, data.get("task_id"), list(goals)),
            )
            self.route_thread.daemon = True
            self.route_thread.start()
            return self.status_locked()

    def _run_route(self, execution_id, task_id, goals):
        rospy.loginfo(
            "navigation route %s accepted: %s goals",
            execution_id,
            len(goals),
        )
        self._prepare_route_costmaps(execution_id)
        for index, goal_data in enumerate(goals, start=1):
            if rospy.is_shutdown():
                return

            with self.lock:
                if (
                    self.navigation_state.get("execution_id") != execution_id
                    or not self.navigation_state.get("active")
                ):
                    return

            try:
                move_goal = self._build_move_base_goal(goal_data)
                started_at = time.time()
                with self.lock:
                    result = self.navigation_state["results"][index - 1]
                    result.update({
                        "state": "moving",
                        "started_at": started_at,
                    })
                    self.navigation_state.update({
                        "active": True,
                        "mode": "route",
                        "state": "moving",
                        "task_id": task_id,
                        "point_id": goal_data.get("point_id"),
                        "point_name": goal_data.get("point_name"),
                        "route_index": index,
                        "route_total": len(goals),
                        "last_status": "goal_sent",
                        "last_error": None,
                    })
                    self._touch_navigation_locked()

                rospy.loginfo(
                    "route %s send goal %s/%s: %s",
                    execution_id,
                    index,
                    len(goals),
                    goal_data.get("point_id"),
                )
                self.move_base_client.send_goal(move_goal)
                timeout = rospy.Duration(float(self.route_goal_timeout))
                finished = self.move_base_client.wait_for_result(timeout)

                with self.lock:
                    if (
                        self.navigation_state.get("execution_id") != execution_id
                        or not self.navigation_state.get("active")
                    ):
                        return

                if not finished:
                    self.move_base_client.cancel_goal()
                    raise RuntimeError("goal timed out")

                move_base_state = self.move_base_client.get_state()
                if move_base_state != GoalStatus.SUCCEEDED:
                    raise RuntimeError(
                        "move_base returned state %s" % move_base_state
                    )

                finished_at = time.time()
                with self.lock:
                    result = self.navigation_state["results"][index - 1]
                    result.update({
                        "state": "arrived",
                        "finished_at": finished_at,
                        "move_base_state": int(move_base_state),
                    })
                    self.navigation_state.update({
                        "state": "arrived",
                        "reached_count": index,
                        "last_status": "goal_reached",
                    })
                    self._touch_navigation_locked()

                rospy.loginfo(
                    "route %s reached goal %s/%s: %s",
                    execution_id,
                    index,
                    len(goals),
                    goal_data.get("point_id"),
                )
                rospy.sleep(float(self.route_arrival_pause))
            except Exception as error:
                with self.lock:
                    if self.navigation_state.get("execution_id") != execution_id:
                        return
                    result = self.navigation_state["results"][index - 1]
                    result.update({
                        "state": "failed",
                        "finished_at": time.time(),
                        "move_base_state": (
                            int(self.move_base_client.get_state())
                            if self.move_base_client is not None
                            else None
                        ),
                        "error": str(error),
                    })
                    self.navigation_state.update({
                        "active": False,
                        "state": "failed",
                        "last_status": "failed",
                        "last_error": str(error),
                        "completed_at": time.time(),
                    })
                    self._touch_navigation_locked()
                rospy.logerr(
                    "navigation route %s failed at %s/%s (%s): %s",
                    execution_id,
                    index,
                    len(goals),
                    goal_data.get("point_id"),
                    error,
                )
                return

        with self.lock:
            if self.navigation_state.get("execution_id") != execution_id:
                return
            self.navigation_state.update({
                "active": False,
                "state": "completed",
                "point_id": None,
                "point_name": None,
                "route_index": len(goals),
                "route_total": len(goals),
                "reached_count": len(goals),
                "last_status": "route_finished",
                "last_error": None,
                "completed_at": time.time(),
            })
            self._touch_navigation_locked()
        rospy.loginfo("navigation route %s completed", execution_id)

    def publish_loop(self):
        rate = rospy.Rate(self.publish_rate)
        while not rospy.is_shutdown():
            with self.lock:
                navigation_active = bool(self.navigation_state.get("active"))
                stale = (
                    time.time() - self.last_command_time
                ) > self.command_timeout
                linear_x = 0.0 if stale else self.linear_x
                angular_z = 0.0 if stale else self.angular_z

            if not navigation_active:
                msg = Twist()
                msg.linear.x = linear_x
                msg.angular.z = angular_z
                self.publisher.publish(msg)
            rate.sleep()


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def make_handler(controller):
    class VehicleAgentHandler(BaseHTTPRequestHandler):
        def _send_json(self, status_code, data):
            body = json.dumps(data).encode("utf-8")
            self.send_response(status_code)
            self.send_header(
                "Content-Type",
                "application/json; charset=utf-8",
            )
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self):
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                return json.loads(raw.decode("utf-8"))
            except ValueError:
                return None

        def _send_error_json(self, status_code, message):
            self._send_json(status_code, {"detail": message})

        def do_OPTIONS(self):
            self._send_json(200, {"ok": True})

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/navigation_route/status":
                query = parse_qs(parsed.query)
                execution_id = query.get("execution_id", [None])[0]
                try:
                    self._send_json(
                        200,
                        controller.navigation_route_status(execution_id),
                    )
                except ValueError as error:
                    self._send_error_json(404, str(error))
                return

            if parsed.path in ("/health", "/status"):
                self._send_json(200, controller.status())
                return

            self._send_json(404, {"detail": "Not found"})

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/cmd_vel":
                data = self._read_json()
                if data is None:
                    self._send_error_json(400, "Invalid JSON")
                    return
                status = controller.set_command(
                    data.get("linear_x", 0.0),
                    data.get("angular_z", 0.0),
                    data.get("acceleration"),
                )
                self._send_json(200, status)
                return

            if parsed.path == "/stop":
                self._send_json(200, controller.stop())
                return

            if parsed.path == "/navigation_route/cancel":
                data = self._read_json()
                if data is None:
                    self._send_error_json(400, "Invalid JSON")
                    return
                try:
                    self._send_json(
                        200,
                        controller.cancel_navigation_route(
                            data.get("execution_id"),
                        ),
                    )
                except ValueError as error:
                    self._send_error_json(404, str(error))
                return

            if parsed.path == "/navigation_goal":
                data = self._read_json()
                if data is None:
                    self._send_error_json(400, "Invalid JSON")
                    return
                try:
                    self._send_json(
                        200,
                        controller.send_navigation_goal(data),
                    )
                except RuntimeError as error:
                    self._send_error_json(409, str(error))
                except Exception as error:
                    self._send_error_json(503, str(error))
                return

            if parsed.path == "/navigation_route":
                data = self._read_json()
                if data is None:
                    self._send_error_json(400, "Invalid JSON")
                    return
                try:
                    self._send_json(
                        202,
                        controller.send_navigation_route(data),
                    )
                except ValueError as error:
                    self._send_error_json(400, str(error))
                except RuntimeError as error:
                    self._send_error_json(409, str(error))
                except Exception as error:
                    self._send_error_json(503, str(error))
                return

            self._send_json(404, {"detail": "Not found"})

        def log_message(self, format_text, *args):
            rospy.loginfo("vehicle_agent: " + format_text, *args)

    return VehicleAgentHandler


def main():
    rospy.init_node("vehicle_agent")
    controller = VehicleController()
    host = rospy.get_param("~host", "0.0.0.0")
    port = int(rospy.get_param("~port", 9000))
    server = ThreadedHTTPServer((host, port), make_handler(controller))
    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()
    rospy.loginfo("vehicle_agent listening on %s:%s", host, port)

    try:
        controller.publish_loop()
    finally:
        controller.stop()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
