#!/bin/bash
# 接收单条构建命令作为参数
BUILD_CMD="$1"

# 如果命令为空，直接退出
if [ -z "$BUILD_CMD" ]; then
  echo "错误: 未提供构建命令"
  exit 1
fi

# 设置自动接受所有提示的环境变量
export DEBIAN_FRONTEND=noninteractive
export FORCE_COLOR=1
export CI=true
export CONTINUOUS_INTEGRATION=true
export npm_config_yes=true
export YARN_ENABLE_IMMUTABLE_INSTALLS=false
export PNPM_HOME="${PNPM_HOME:-"$HOME/.local/share/pnpm"}"
export BUN_INSTALL_CACHE="$HOME/.bun/install/cache"
export BUN_CONFIG_YES=true

# 创建临时脚本
TMP_SCRIPT=$(mktemp)
echo "#!/bin/bash" > $TMP_SCRIPT
echo "set -e" >> $TMP_SCRIPT
echo "# 开始执行命令: $BUILD_CMD" >> $TMP_SCRIPT
echo "$BUILD_CMD" >> $TMP_SCRIPT
chmod +x $TMP_SCRIPT

# 创建expect脚本
TMP_EXPECT=$(mktemp)
cat > $TMP_EXPECT << 'EOF'
#!/usr/bin/expect -f
set timeout 600
set command [lindex $argv 0]

puts "开始通过expect执行命令: $command"
spawn $command

# 处理各种交互式提示
expect {
    -re {(y/n|y/N|Y/n|yes/no)} { send "y\r"; exp_continue }
    -re {(Press Enter to continue|Press ENTER|Press any key to continue|to continue|continue\?)} { send "\r"; exp_continue }
    -re {(\? Select|Choose one|Select:|select:|Please choose:|\?.*\[)} { send "1\r"; exp_continue }
    -re {(overwrite|already exists)} { send "y\r"; exp_continue }
    -re {confirm\?} { send "y\r"; exp_continue }
    timeout { puts "命令执行超时"; exit 1 }
    eof
}

set wait_result [wait]
set exit_status [lindex $wait_result 3]
exit $exit_status
EOF
chmod +x $TMP_EXPECT

echo "执行命令: $BUILD_CMD"
echo "----------------------------------------"

# 执行命令，尝试多种方法处理交互
$TMP_EXPECT $TMP_SCRIPT
EXPECT_STATUS=$?

if [ $EXPECT_STATUS -ne 0 ]; then
  echo "Expect方法失败 (状态码: $EXPECT_STATUS)，使用yes命令尝试..."
  yes "" | $TMP_SCRIPT
  YES_STATUS=$?

  if [ $YES_STATUS -ne 0 ]; then
    echo "Yes方法失败 (状态码: $YES_STATUS)，使用echo尝试..."
    (echo -e "\n\ny\ny\n1\n" | $TMP_SCRIPT)
    ECHO_STATUS=$?

    if [ $ECHO_STATUS -ne 0 ]; then
      echo "Echo方法失败 (状态码: $ECHO_STATUS)，直接执行命令..."
      bash -c "$BUILD_CMD"
      DIRECT_STATUS=$?

      if [ $DIRECT_STATUS -ne 0 ]; then
        echo "所有执行方法均失败，命令执行失败: $BUILD_CMD"
        exit $DIRECT_STATUS
      fi
    fi
  fi
fi

echo "----------------------------------------"
echo "命令执行成功: $BUILD_CMD"

# 清理临时文件
rm -f $TMP_SCRIPT $TMP_EXPECT
exit 0
