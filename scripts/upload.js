#!/usr/bin/env node
/**
 * 微信小程序自动上传脚本
 * 
 * 使用方法：
 * node scripts/upload.js --appid YOUR_APPID --privateKeyPath /path/to/private.key --version 1.0.1 --desc "描述"
 * 
 * 环境变量：
 * - APP_ID: 小程序 AppID
 * - PRIVATE_KEY_PATH: 小程序上传私钥文件路径（在微信公众平台生成）
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  
  const appid = args.appid || process.env.APP_ID;
  const privateKeyPath = args.privateKeyPath || args.privateKey || process.env.PRIVATE_KEY_PATH;
  const version = args.version || '1.0.0';
  const desc = args.desc || 'Auto deploy';

  if (!appid) {
    console.error('错误: 请提供 --appid 参数');
    process.exit(1);
  }

  if (!privateKeyPath) {
    console.error('错误: 请提供 --privateKeyPath 参数');
    process.exit(1);
  }

  if (!fs.existsSync(privateKeyPath)) {
    console.error(`错误: 私钥文件不存在: ${privateKeyPath}`);
    process.exit(1);
  }

  const ci = require('miniprogram-ci');

  const project = {
    appid,
    projectpath: path.resolve(__dirname, '..'),
    privateKeyPath,
    ignores: ['node_modules/**', '.git/**'],
  };

  console.log(`开始上传小程序: ${appid}`);
  console.log(`版本: ${version}`);
  console.log(`描述: ${desc}`);

  try {
    const result = await ci.upload({
      project,
      version,
      desc,
      onProgressUpdate: (info) => {
        console.log(`上传进度: ${info.progress}%`);
      },
    });

    console.log('上传成功!');
    console.log(`上传 ID: ${result.uploadId}`);
    
    // 可选：自动提交审核
    // if (args.autoSubmit) {
    //   await ci.submit({ project });
    //   console.log('已提交审核');
    // }
  } catch (error) {
    console.error('上传失败:', error.message);
    process.exit(1);
  }
}

main();
