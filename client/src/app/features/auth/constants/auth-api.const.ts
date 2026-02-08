const AUTH_API_V1 = 'api/v1/auth';

export enum AuthEndpointEnum {
  Login = `${AUTH_API_V1}/login`,
  Register = `${AUTH_API_V1}/register`,
  Logout = `${AUTH_API_V1}/logout`,
  Profile = `${AUTH_API_V1}/profile`,
  RefreshToken = `${AUTH_API_V1}/refresh-token`,
}
