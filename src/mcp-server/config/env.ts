import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// 加载环境变量，指定.env文件路径
const envPath = path.resolve(process.cwd(), '.env');
console.log('Loading .env from:', envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('Warning: Could not load .env file:', result.error.message);
} else {
  console.log('✅ .env file loaded successfully');
}

// 环境变量验证schema
const envSchema = z.object({
  LARK_APP_ID: z.string().min(1, "LARK_APP_ID is required").optional(),
  LARK_APP_SECRET: z.string().min(1, "LARK_APP_SECRET is required").optional(),
  LARK_BASE_URL: z.string().url("LARK_BASE_URL must be a valid URL").default("https://open.feishu.cn"),
  LARK_SCOPES: z.string().default(""),
  PORT: z.string().transform(val => parseInt(val, 10)).default("3000")
});

// 验证环境变量
function validateEnv() {
  console.log('🔍 Checking environment variables...');
  console.log('LARK_APP_ID:', process.env.LARK_APP_ID ? `✅ Set (${process.env.LARK_APP_ID})` : '❌ Missing');
  console.log('LARK_APP_SECRET:', process.env.LARK_APP_SECRET ? `✅ Set (${process.env.LARK_APP_SECRET.substring(0, 8)}...)` : '❌ Missing');
  console.log('LARK_BASE_URL:', process.env.LARK_BASE_URL || 'Using default');
  console.log('LARK_SCOPES:', process.env.LARK_SCOPES || 'Using default');
  
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Environment validation failed:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
}

// 导出验证后的环境变量
export const env = validateEnv();

// 导出Lark配置
export const larkConfig = {
  appId: process.env.LARK_APP_ID || 'your_app_id_here',
  appSecret: process.env.LARK_APP_SECRET || 'your_app_secret_here',
  baseUrl: env.LARK_BASE_URL,
  scopes: env.LARK_SCOPES ? env.LARK_SCOPES.split(',').map(scope => scope.trim()).filter(s => s) : [],
  port: env.PORT
};

// 检查是否有必需的环境变量
export function checkRequiredEnvVars(): { isValid: boolean; missingVars: string[] } {
  const requiredVars = ['LARK_APP_ID', 'LARK_APP_SECRET'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  return {
    isValid: missingVars.length === 0,
    missingVars
  };
} 