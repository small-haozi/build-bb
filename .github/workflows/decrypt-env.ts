/**
 * 环境变量解密工具
 * 用于解密在GitHub Actions工作流中传递的加密环境变量
 */
import { createDecipheriv } from 'crypto';
import { writeFileSync } from 'fs';

/**
 * 使用提供的密钥解密加密数据
 * @param encryptedData 加密的数据（格式：iv:encrypted）
 * @param key 解密密钥
 * @returns 解密后的数据
 */
function decrypt(encryptedData: string, key: string): string {
  try {
    // 分割IV和加密内容
    const [ivBase64, encryptedBase64] = encryptedData.split(':');

    if (!ivBase64 || !encryptedBase64) {
      throw new Error('加密数据格式无效');
    }

    // 确保密钥长度为32字节（256位）
    const keyBuffer = Buffer.from(key.padEnd(32, '0').slice(0, 32));

    // 从base64还原IV
    const iv = Buffer.from(ivBase64, 'base64');

    // 创建解密器
    const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv);

    // 解密数据
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('解密失败:', error instanceof Error ? error.message : String(error));
    return '';
  }
}

/**
 * 主函数
 */
function main() {
  // 获取命令行参数
  const args = process.argv.slice(2);
  const encryptedData = args[0];
  const key = args[1];
  const outputFile = args[2];

  if (!encryptedData || !key) {
    console.error('用法: bun decrypt-env.ts <加密数据> <密钥> [输出文件路径]');
    process.exit(1);
  }

  try {
    // 解密数据
    const decrypted = decrypt(encryptedData, key);
    if (!decrypted) {
      throw new Error('解密结果为空');
    }

    // 解析JSON格式的环境变量
    const envVars = JSON.parse(decrypted);

    // 检查是否为对象
    if (typeof envVars !== 'object' || envVars === null) {
      throw new Error('解密后的数据不是有效的环境变量对象');
    }

    // 输出环境变量
    const output = Object.entries(envVars).map(([key, value]) => {
      // 对于GitHub Actions，使用mask功能隐藏敏感值
      console.error(`::add-mask::${value}`);
      return `${key}=${value}`;
    }).join('\n');

    // 如果指定了输出文件，将内容写入文件
    if (outputFile) {
      writeFileSync(outputFile, output);
      console.error(`环境变量已写入文件: ${outputFile}`);
    } else {
      // 否则输出到标准输出
      console.log(output);
    }

  } catch (error) {
    console.error('处理环境变量失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// 执行主函数
main();
