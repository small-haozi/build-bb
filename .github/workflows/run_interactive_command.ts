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

// 标记是否正在响应交互，防止重复响应
let isResponding = false;

// 常见的需要交互响应的提示符及其回答
const interactions = [
  // Nuxt/Next.js 特定的更新菜单
  {
    prompt: /Ready to apply the static updates to your app\?[\s\S]*● Yes[\s\S]*○ Nope/im,
    response: '\n',  // 确认已选中的Yes选项
    description: "Nuxt/Next.js更新确认"
  },

  // 通用选择菜单模式，但匹配优先级较低
  {
    prompt: /[◆│].*\n.*● .*\n.*○ .*\n.*[└]/s,
    response: '\n',  // 对于已选择的选项直接回车
    description: "已选择选项的菜单"
  },
  {
    prompt: /[◆│].*\n.*○ .*\n.*● .*\n.*[└]/s,
    response: ' \n',  // 先空格切换选择，再回车
    description: "未选择选项的菜单"
  },

  // 确认类型的交互，优先级较低
  {
    prompt: /(?:y\/n|y\/N|Y\/n|yes\/no)/i,
    response: 'y\n',
    description: "是/否确认提示"
  },

  // 确认类型的交互
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
        // 发送响应
        proc.stdin.write(interaction.response);
        console.log(`已发送响应，长度: ${interaction.response.length}`);

        // 2秒后重置响应状态
        setTimeout(() => {
          isResponding = false;
          outputBuffer = ''; // 清空缓冲区
        }, 2000);
      }, 500);

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
