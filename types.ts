
export interface RegistrationPayload {
  username: string;
  email: string;
  password1: string;
  password2: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  method: 'mobile_phone';
  plan_pricing: string;
}

export interface RegistrationResponse {
  token?: string;
  key?: string;
  detail?: string;
  username?: string[];
  [key: string]: any;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface UsageResponse {
  checks: Array<{
    value: number;
    result: number;
    [key: string]: any;
  }>;
}

export interface OtpVerifyResponse {
  detail?: string;
  status?: string;
}
