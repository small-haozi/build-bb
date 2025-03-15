/**
 * Interactive Command Runner
 *
 * 这个脚本用于执行可能需要交互的命令，处理输入/输出，在不同系统环境中保持兼容性
 * 更加严格地模拟原始shell脚本的行为
 */

import { spawn, execSync, spawnSync } from 'child_process';
import { writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// 获取命令参数
const command = process.argv[2];
// 获取工作目录参数
const workingDir = process.argv[3] || process.cwd();

if (!command) {
  console.error('错误: 未提供命令');
  process.exit(1);
}

console.log(`执行命令: ${command}`);
console.log(`工作目录: ${workingDir}`);

// 设置环境变量以减少交互 - 与原始shell脚本完全一致
const env = {
  ...process.env,
  DEBIAN_FRONTEND: 'noninteractive',
  FORCE_COLOR: '1',
  CI: 'true',
  CONTINUOUS_INTEGRATION: 'true',
  npm_config_yes: 'true',
  YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  PNPM_HOME: process.env.PNPM_HOME || `${process.env.HOME}/.local/share/pnpm`,
  BUN_INSTALL_CACHE: `${process.env.HOME}/.bun/install/cache`,
  BUN_CONFIG_YES: 'true'
};

// 创建临时脚本文件，与原始shell脚本一致
function createTempScript(command) {
  const tempFile = join(tmpdir(), `command-${Date.now()}.sh`);
  writeFileSync(tempFile,
`#!/bin/bash
set -e
cd "${workingDir}"
# 开始执行命令: ${command}
${command}
`);
  chmodSync(tempFile, '755');
  return tempFile;
}

// 主执行函数
async function executeCommand() {
  // 创建临时脚本
  const scriptFile = createTempScript(command);
  console.log(`创建临时脚本: ${scriptFile}`);

  // 尝试方法1: 使用expect风格的交互处理
  try {
    console.log("方法1: 使用TypeScript交互处理...");
    const success = await executeWithInteractiveHandling(scriptFile);
    if (success) {
      console.log("方法1成功!");
      return;
    }
  } catch (err) {
    console.error(`方法1失败: ${err.message}`);
  }

  // 尝试方法2: 使用yes命令
  try {
    console.log("方法2: 使用yes命令...");
    execSync(`yes "" | ${scriptFile}`, {
      stdio: 'inherit',
      env,
      cwd: workingDir
    });
    console.log("方法2成功!");
    return;
  } catch (err) {
    console.error(`方法2失败: ${err.message}`);
  }

  // 尝试方法3: 使用echo发送常用输入
  try {
    console.log("方法3: 使用echo预发送输入...");
    execSync(`echo -e "\\n\\ny\\ny\\n1\\n" | ${scriptFile}`, {
      stdio: 'inherit',
      env,
      cwd: workingDir,
      shell: true
    });
    console.log("方法3成功!");
    return;
  } catch (err) {
    console.error(`方法3失败: ${err.message}`);
  }

  // 尝试方法4: 直接执行命令
  try {
    console.log("方法4: 直接执行命令...");
    execSync(command, {
      stdio: 'inherit',
      env,
      cwd: workingDir,
      shell: true
    });
    console.log("方法4成功!");
    return;
  } catch (err) {
    console.error(`所有方法均失败，命令执行失败: ${err.message}`);
    process.exit(1);
  }
}

// 使用TypeScript模拟expect风格的交互处理
function executeWithInteractiveHandling(scriptFile) {
  return new Promise((resolve, reject) => {
    console.log(`执行脚本: ${scriptFile}`);

    const proc = spawn(scriptFile, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: workingDir
    });

    // 定义交互模式匹配规则 - 尽可能与expect脚本匹配
    const interactionPatterns = [
      { regex: /(y\/n|y\/N|Y\/n|yes\/no)/i, response: "y\r" },
      { regex: /(Press Enter to continue|Press ENTER|Press any key to continue|to continue|continue\?)/i, response: "\r" },
      { regex: /(\? Select|Choose one|Select:|select:|Please choose:|\?.*\[)/i, response: "1\r" },
      { regex: /(overwrite|already exists)/i, response: "y\r" },
      { regex: /confirm\?/i, response: "y\r" }
    ];

    let buffer = '';
    const bufferMaxSize = 1000;
    let isResponding = false;

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);

      buffer += output;
      if (buffer.length > bufferMaxSize) {
        buffer = buffer.substring(buffer.length - bufferMaxSize);
      }

      checkForInteractionAndRespond();
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      process.stderr.write(output);

      buffer += output;
      if (buffer.length > bufferMaxSize) {
        buffer = buffer.substring(buffer.length - bufferMaxSize);
      }

      checkForInteractionAndRespond();
    });

    function checkForInteractionAndRespond() {
      if (isResponding) return;

      for (const pattern of interactionPatterns) {
        if (pattern.regex.test(buffer)) {
          isResponding = true;
          console.log(`检测到交互提示，匹配: ${pattern.regex}`);

          setTimeout(() => {
            proc.stdin.write(pattern.response);
            console.log(`发送响应: ${pattern.response.replace(/\r/g, '\\r')}`);

            setTimeout(() => {
              isResponding = false;
              buffer = '';
            }, 1000);
          }, 500);

          break;
        }
      }
    }

    proc.on('close', (code) => {
      console.log(`进程退出码: ${code}`);
      clearTimeout(timeout);

      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`脚本执行失败，退出码: ${code}`));
      }
    });

    proc.on('error', (err) => {
      console.error(`执行错误: ${err.message}`);
      clearTimeout(timeout);
      reject(err);
    });

    // 设置超时，与shell脚本中expect的设置相同
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('执行超时 (600秒)'));
    }, 600 * 1000);
  });
}

// 开始执行命令
executeCommand()
  .then(() => {
    console.log("命令执行成功完成");
    process.exit(0);
  })
  .catch((err) => {
    console.error(`命令执行失败: ${err.message}`);
    process.exit(1);
  });
