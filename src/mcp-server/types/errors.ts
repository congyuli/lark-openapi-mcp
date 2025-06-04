// 基础错误类型
export abstract class McpServerError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
  }
}

// 用户相关错误
export class UserNotFoundError extends McpServerError {
  readonly code = 'USER_NOT_FOUND';
  readonly statusCode = 404;
}

export class UserSessionExpiredError extends McpServerError {
  readonly code = 'USER_SESSION_EXPIRED';
  readonly statusCode = 401;
}

export class InvalidUserTokenError extends McpServerError {
  readonly code = 'INVALID_USER_TOKEN';
  readonly statusCode = 401;
}

export class UserAlreadyExistsError extends McpServerError {
  readonly code = 'USER_ALREADY_EXISTS';
  readonly statusCode = 409;
}

// 资源管理相关错误
export class MaxUsersExceededError extends McpServerError {
  readonly code = 'MAX_USERS_EXCEEDED';
  readonly statusCode = 429;
}

export class MaxConnectionsExceededError extends McpServerError {
  readonly code = 'MAX_CONNECTIONS_EXCEEDED';
  readonly statusCode = 429;
}

export class LarkClientCreationError extends McpServerError {
  readonly code = 'LARK_CLIENT_CREATION_FAILED';
  readonly statusCode = 500;
}

export class ConnectionNotFoundError extends McpServerError {
  readonly code = 'CONNECTION_NOT_FOUND';
  readonly statusCode = 404;
}

export class ResourceCleanupError extends McpServerError {
  readonly code = 'RESOURCE_CLEANUP_FAILED';
  readonly statusCode = 500;
}

// 错误类型判断函数
export function isUserError(error: Error): error is UserNotFoundError | UserSessionExpiredError | InvalidUserTokenError {
  return error instanceof UserNotFoundError || 
         error instanceof UserSessionExpiredError || 
         error instanceof InvalidUserTokenError;
}

export function isResourceError(error: Error): error is MaxUsersExceededError | MaxConnectionsExceededError | LarkClientCreationError {
  return error instanceof MaxUsersExceededError || 
         error instanceof MaxConnectionsExceededError || 
         error instanceof LarkClientCreationError;
}

// 错误响应格式
export interface ErrorResponse {
  error: string;
  error_description: string;
  error_code: string;
  timestamp: string;
} 