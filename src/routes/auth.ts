import { v4 } from "uuid";
import { CONFIG } from "../config";
import { stringify } from "querystring";
import { SECRETS } from "../secrets";
import Router from "@koa/router";
import axios, { AxiosRequestConfig } from "axios";
import { EnhancedContext } from "../middleware";
import { UserSessionDataKind } from "../services/datastore/kinds";
import { handleAxiosError } from "../errors";

export function initAuthRoutes(router: Router) {
  router.get("/login", function (ctx) {
    const state = v4();
    ctx.cookies.set(CONFIG.spotifyStateKey, state);

    // your application requests authorization
    const scope = CONFIG.scope;
    ctx.redirect(
      "https://accounts.spotify.com/authorize?" +
        stringify({
          response_type: "code",
          client_id: SECRETS.clientId,
          scope: scope,
          redirect_uri: CONFIG.redirectUri,
          state: state,
        })
    );
  });

  router.get("/oauth_callback", async function (ctx: EnhancedContext, next) {
    // your application requests refresh and access tokens
    // after checking the state parameter

    const code = ctx.request.query.code || null;
    const state = ctx.request.query.state || null;
    const storedState = ctx.cookies.get(CONFIG.spotifyStateKey);

    ctx.logger.debug("Begin oath callback", {
      code,
      state,
      storedState,
    });

    if (state === null || state !== storedState) {
      ctx.logger.warn("Failed to authorize properly: mismatch in state", {
        state: state || "N/A",
        storedState: storedState || "N/A",
      });
      throw new Error("Failed to authorize properly");
    }

    ctx.cookies.set(CONFIG.spotifyStateKey, "");

    const params = new URLSearchParams();
    params.append("code", code as string);
    params.append("redirect_uri", CONFIG.redirectUri);
    params.append("grant_type", "authorization_code");
    const authOptions: AxiosRequestConfig = {
      method: "POST",
      url: "https://accounts.spotify.com/api/token",
      data: params.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(SECRETS.clientId + ":" + SECRETS.clientSecret).toString(
            "base64"
          ),
      },
      timeout: 320000,
      timeoutErrorMessage: "Request timed out",
      responseType: "json",
    };
    ctx.logger.debug("Using client is and secret", {
      clientId: SECRETS.clientId.substring(0, 5) + "...",
      clientSecret: SECRETS.clientSecret.substring(0, 5) + "...",
    });
    ctx.logger.debug("Calling spotify for token", { authOptions });

    const authPostResponse = await axios(authOptions).catch(handleAxiosError);
    const authPostResponseData = authPostResponse.data;
    ctx.logger.info("Auth response", { authPostResponseData });
    const accessTokenExpiryDate = new Date(
      Date.now() + authPostResponseData.expires_in * 1000
    );
    if (authPostResponse.status === 200) {
      const accessToken = authPostResponse.data.access_token;

      const options: AxiosRequestConfig = {
        method: "GET",
        url: "https://api.spotify.com/v1/me",
        headers: { Authorization: "Bearer " + accessToken },
        responseType: "json",
      };

      const testGetResponse = await axios(options).catch(handleAxiosError);
      const meData = testGetResponse.data;
      const userSpotifyId = meData.id;
      const token = ctx.jwtService.sign({
        userSpotifyId,
        accessToken: authPostResponse.data.access_token,
        accessTokenExpiryTime: accessTokenExpiryDate.getTime().toString(),
      });
      const userSessionDataRepository =
        ctx.datastoreService.getRepository("userSessionData");
      await userSessionDataRepository.save(
        new UserSessionDataKind({
          userSpotifyId,
          accessToken,
          accessTokenExpiryDateTime: accessTokenExpiryDate,
          refreshToken: authPostResponseData.refresh_token,
        })
      );
      ctx.redirect(`${CONFIG.frontEndHost}/landing?token=${token}`);
    } else {
      throw new Error("Invalid token");
    }
    await next();
  });
}
