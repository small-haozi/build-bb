/**
 * Interactive Command Runner
 *
 * 这个脚本用于执行可能需要交互的命令，处理输入/输出，在不同系统环境中保持兼容性
 * 参考了shell版本的多种交互处理机制
 */

import { spawn, execSync } from 'child_process';
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

// 设置环境变量以减少交互
const env = {
  ...process.env,
  DEBIAN_FRONTEND: 'noninteractive',
  FORCE_COLOR: '1',
  CI: 'true',
  CONTINUOUS_INTEGRATION: 'true',
  npm_config_yes: 'true',
  YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  BUN_CONFIG_YES: 'true',
  PNPM_HOME: process.env.PNPM_HOME || `${process.env.HOME}/.local/share/pnpm`,
  BUN_INSTALL_CACHE: `${process.env.HOME}/.bun/install/cache`
};

// 特殊的ANSI序列常量
const ENTER = '\r';
const DOWN_ARROW = '\u001B[B';
const SPACE = ' ';

// 创建临时脚本文件
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

// 主要执行函数
async function executeCommand() {
  // 尝试方法1: 使用spawn监听交互
  try {
    console.log("方法1: 使用spawn监听交互...");
    const success = await executeWithSpawn();
    if (success) return;
  } catch (err) {
    console.error(`方法1失败: ${err.message}`);
  }

  // 尝试方法2: 使用yes命令
  try {
    console.log("方法2: 使用yes命令...");
    const scriptFile = createTempScript(command);
    execSync(`yes "" | ${scriptFile}`, {
      stdio: 'inherit',
      cwd: workingDir,
      env
    });
    console.log("方法2成功!");
    return;
  } catch (err) {
    console.error(`方法2失败: ${err.message}`);
  }

  // 尝试方法3: 预发送输入
  try {
    console.log("方法3: 预发送常用输入...");
    execSync(`echo -e "\\n\\ny\\ny\\n1\\n" | ${command}`, {
      stdio: 'inherit',
      cwd: workingDir,
      env,
      shell: true
    });
    console.log("方法3成功!");
    return;
  } catch (err) {
    console.error(`方法3失败: ${err.message}`);
  }

  // 尝试方法4: 直接执行
  try {
    console.log("方法4: 直接执行命令...");
    execSync(`bash -c "${command}"`, {
      stdio: 'inherit',
      cwd: workingDir,
      env
    });
    console.log("方法4成功!");
    return;
  } catch (err) {
    console.error(`所有方法均失败，命令执行失败: ${err.message}`);
    process.exit(1);
  }
}

// 标记是否正在响应交互，防止重复响应
let isResponding = false;

// 常见的需要交互响应的提示符及其回答
const interactions = [
  // 通用选择菜单模式
  {
    prompt: /[◆│].*\n.*● .*\n.*○ .*\n.*[└]/s,
    response: ENTER,
    description: "已选择选项的菜单"
  },
  {
    prompt: /[◆│].*\n.*○ .*\n.*● .*\n.*[└]/s,
    response: DOWN_ARROW + SPACE + ENTER,
    description: "未选择选项的菜单"
  },

  // 确认类型的交互
  {
    prompt: /(?:y\/n|y\/N|Y\/n|yes\/no)/i,
    response: 'y\n',
    description: "是/否确认提示"
  },
  { prompt: /(?:proceed|continue|confirm)\?/i, response: 'y\n' },
  { prompt: /(?:do you want to|would you like to|are you sure)/i, response: 'y\n' },
  { prompt: /(?:overwrite|already exists)/i, response: 'y\n' },

  // 按回车继续类型
  { prompt: /(?:press enter|press ENTER|press any key|to continue)/i, response: '\n' },

  // 选择选项类型
  { prompt: /(?:\? select|\? choose|select:|please choose:|choose one:)/i, response: '1\n' },
  { prompt: /\?.*\[/i, response: '\n' }, // 通用选择项模式

  // 其他安装确认
  { prompt: /(?:install|download|fetch|update)/i, response: 'y\n' },
];

// 使用spawn执行命令并监听交互
function executeWithSpawn() {
  return new Promise((resolve, reject) => {
    // 解析命令和参数
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: workingDir
    });

    // 命令输出缓冲区，用于检测跨多行的交互提示
    let outputBuffer = '';
    const bufferMaxSize = 1000; // 限制缓冲区大小

    // 处理stdout和stderr
    proc.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);

      // 更新输出缓冲区
      outputBuffer += output;
      if (outputBuffer.length > bufferMaxSize) {
        outputBuffer = outputBuffer.substring(outputBuffer.length - bufferMaxSize);
      }

      // 检查是否有需要响应的提示符
      checkForPrompts();
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      process.stderr.write(output);

      // 错误输出也可能包含需要交互的提示
      outputBuffer += output;
      if (outputBuffer.length > bufferMaxSize) {
        outputBuffer = outputBuffer.substring(outputBuffer.length - bufferMaxSize);
      }

      // 检查是否有需要响应的提示符
      checkForPrompts();
    });

    // 检查提示并响应
    function checkForPrompts() {
      if (isResponding) return; // 防止重复响应

      for (const interaction of interactions) {
        if (interaction.prompt.test(outputBuffer)) {
          isResponding = true;

          console.log(`检测到交互提示类型: ${interaction.description || '未命名'}`);

          // 为了调试，显示匹配到的内容（但隐藏敏感信息）
          const matchedText = outputBuffer.match(interaction.prompt)?.[0] || '';
          if (matchedText) {
            console.log(`匹配内容: ${matchedText.length > 100 ?
              matchedText.substring(0, 50) + '...' + matchedText.substring(matchedText.length - 50) :
              matchedText}`);
          }

          // 添加延迟以确保命令行界面已完全渲染
          console.log(`将在500ms后发送响应: ${JSON.stringify(interaction.response)}`);
          setTimeout(() => {
            // 发送响应，逐个字符，中间添加小延迟
            const chars = [...interaction.response];
            let index = 0;

            const sendNextChar = () => {
              if (index < chars.length) {
                const char = chars[index++];
                proc.stdin.write(char);
                console.log(`发送字符: '${char.replace('\r', '\\r').replace('\n', '\\n')}' [${char.charCodeAt(0)}]`);
                setTimeout(sendNextChar, 150); // 字符间延迟
              } else {
                console.log('所有响应已发送');
                // 延迟后重置状态
                setTimeout(() => {
                  isResponding = false;
                  outputBuffer = '';
                }, 2000);
              }
            };

            sendNextChar();
          }, 800); // 增加初始延迟

          break;
        }
      }
    }

    // 处理命令执行完成
    proc.on('close', (code) => {
      console.log(`命令执行完成，退出码: ${code}`);
      clearTimeout(timeout);
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`进程退出状态码: ${code}`));
      }
    });

    // 处理错误
    proc.on('error', (err) => {
      console.error(`命令执行错误: ${err}`);
      clearTimeout(timeout);
      reject(err);
    });

    // 设置命令超时（10分钟）
    const timeout = setTimeout(() => {
      console.error('命令执行超时');
      proc.kill();
      reject(new Error('执行超时'));
    }, 10 * 60 * 1000);
  });
}

// 执行命令
executeCommand().then(() => {
  console.log("命令执行成功");
  process.exit(0);
}).catch(err => {
  console.error("命令执行失败:", err);
  process.exit(1);
});
