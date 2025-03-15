/**
 * Interactive Command Runner
 *
 * 这个脚本用于执行可能需要交互的命令，处理输入/输出，在不同系统环境中保持兼容性
 */

import { spawn } from 'child_process';

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

// 解析命令和参数
const parts = command.split(' ');
const cmd = parts[0];
const args = parts.slice(1);

// 设置环境变量以减少交互
const env = {
  ...process.env,
  DEBIAN_FRONTEND: 'noninteractive',
  FORCE_COLOR: '1',
  CI: 'true',
  CONTINUOUS_INTEGRATION: 'true',
  npm_config_yes: 'true',
  YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  BUN_CONFIG_YES: 'true'
};

// 常见的需要交互响应的提示符及其回答
const interactions = [
  // 选择菜单类型的交互 - 针对特定UI格式的选择菜单，如Nuxt/Next.js更新提示等
  {
    prompt: /Ready to apply.*\?.*● Yes|○ No|◆.*Yes.*No/s,
    response: '\n'  // 直接回车确认默认选项
  },
  {
    prompt: /● .*\n.*○ .*\n.*└/s,
    response: '\n'  // 针对已选择项为●的菜单直接按回车
  },
  {
    prompt: /○ .*\n.*● .*\n.*└/s,
    response: ' \n'  // 先发送空格切换选择，再按回车
  },

  // 确认类型的交互
  { prompt: /(?:y\/n|y\/N|Y\/n|yes\/no)/i, response: 'y\n' },
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

console.log(`执行命令: ${command}`);

// 使用spawn执行命令，允许交互
const proc = spawn(cmd, args, {
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env,
  cwd: workingDir // 设置工作目录
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
  for (const interaction of interactions) {
    if (interaction.prompt.test(outputBuffer)) {
      console.log(`检测到交互提示，将自动响应...`);
      // 添加延迟以确保命令行界面已完全渲染
      setTimeout(() => {
        // 对于多步响应（如先空格后回车），分开发送
        const responses = interaction.response.split('');
        for (const char of responses) {
          proc.stdin.write(char);
        }
        console.log(`已发送响应: ${interaction.response.replace('\n', '\\n')}`);
      }, 500);
      outputBuffer = '';
      break;
    }
  }
}

// 处理命令执行完成
proc.on('close', (code) => {
  console.log(`命令执行完成，退出码: ${code}`);
  process.exit(code || 0);
});

// 处理错误
proc.on('error', (err) => {
  console.error(`命令执行错误: ${err}`);
  process.exit(1);
});

// 设置命令超时（10分钟）
const timeout = setTimeout(() => {
  console.error('命令执行超时');
  proc.kill();
  process.exit(1);
}, 10 * 60 * 1000);

// 清除超时
proc.on('exit', () => {
  clearTimeout(timeout);
});
