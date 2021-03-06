import { SECRETS } from "../secrets";

import { sign, verify } from "jsonwebtoken";

const { jwtPrivateKey } = SECRETS;

interface JwTPayload {
  userSpotifyId: string;
  accessToken: string;
  accessTokenExpiryTime: string;
}

export class JwtService {
  sign(input: JwTPayload): string {
    return sign(JSON.stringify(input), jwtPrivateKey);
  }
  verify(token: string): JwTPayload {
    return verify(token, jwtPrivateKey) as JwTPayload;
  }
}
