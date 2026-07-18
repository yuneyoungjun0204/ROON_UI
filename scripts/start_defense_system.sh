#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# USV 방어 시뮬레이터 + ROS2 통합 시스템 실행 스크립트
# ─────────────────────────────────────────────────────────────────────────

set -e

echo "=========================================="
echo "  USV 방어 시뮬레이터 시스템 시작"
echo "=========================================="

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 경로 설정
USV_SIM_DIR="/home/yune/민철_UI/usv-simulator"
ROS2_WS="/home/yune/ros2_ws"

# Mosquitto WebSocket 설정 확인
check_mosquitto_config() {
    echo -e "${YELLOW}[1/4] Mosquitto WebSocket 설정 확인...${NC}"

    if [ -f /etc/mosquitto/conf.d/websocket.conf ]; then
        echo -e "${GREEN}  ✓ WebSocket 설정 존재${NC}"
    else
        echo -e "${RED}  ✗ WebSocket 설정 없음${NC}"
        echo ""
        echo "다음 명령어로 설정을 복사하세요:"
        echo "  sudo cp /home/yune/mosquitto_websocket.conf /etc/mosquitto/conf.d/websocket.conf"
        echo "  sudo systemctl restart mosquitto"
        echo ""
        read -p "계속하시겠습니까? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Mosquitto 시작
start_mosquitto() {
    echo -e "${YELLOW}[2/4] Mosquitto 브로커 시작...${NC}"

    if pgrep -x "mosquitto" > /dev/null; then
        echo -e "${GREEN}  ✓ Mosquitto 이미 실행 중${NC}"
    else
        sudo systemctl start mosquitto || mosquitto -c /etc/mosquitto/mosquitto.conf -d
        sleep 1
        if pgrep -x "mosquitto" > /dev/null; then
            echo -e "${GREEN}  ✓ Mosquitto 시작됨${NC}"
        else
            echo -e "${RED}  ✗ Mosquitto 시작 실패${NC}"
            exit 1
        fi
    fi
}

# USV 시뮬레이터 시작
start_usv_simulator() {
    echo -e "${YELLOW}[3/4] USV 시뮬레이터 시작...${NC}"

    cd "$USV_SIM_DIR"

    # 기존 프로세스 확인
    if lsof -i:5173 > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ 시뮬레이터 이미 실행 중 (http://localhost:5173)${NC}"
    else
        npm run dev &
        sleep 3
        echo -e "${GREEN}  ✓ 시뮬레이터 시작됨${NC}"
    fi

    echo ""
    echo -e "${GREEN}  → http://localhost:5173/?mode=defense${NC}"
}

# ROS2 브릿지 시작 안내
show_ros2_instructions() {
    echo -e "${YELLOW}[4/4] ROS2 브릿지 실행 안내${NC}"
    echo ""
    echo "  ROS2 브릿지를 시작하려면 새 터미널에서:"
    echo ""
    echo "    source /opt/ros/humble/setup.bash"
    echo "    source $ROS2_WS/install/setup.bash"
    echo "    ros2 run mqtt_ros2_bridge usv_bridge"
    echo ""
    echo "  oneway_ros2 RL 추론을 실행하려면:"
    echo ""
    echo "    ros2 launch oneway_ros2 oneway.launch.py"
    echo ""
}

# MQTT 테스트 안내
show_test_instructions() {
    echo "=========================================="
    echo "  MQTT 연결 테스트"
    echo "=========================================="
    echo ""
    echo "  python3 scripts/test_mqtt_bridge.py"
    echo ""
    echo "  # 웨이포인트 발행 테스트"
    echo "  python3 scripts/test_mqtt_bridge.py --waypoint"
    echo ""
    echo "  # 시뮬레이션 시작"
    echo "  python3 scripts/test_mqtt_bridge.py --start"
    echo ""
}

# 메인 실행
main() {
    check_mosquitto_config
    start_mosquitto
    start_usv_simulator
    show_ros2_instructions
    show_test_instructions

    echo "=========================================="
    echo -e "${GREEN}  시스템 준비 완료!${NC}"
    echo "=========================================="
}

main "$@"
