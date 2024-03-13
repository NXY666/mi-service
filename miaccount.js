import {createHash, randomBytes} from 'crypto';
import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';
import JSONbig from "json-bigint";

export class MiTokenStore {
	constructor(tokenPath) {
		this.tokenPath = tokenPath;
	}

	loadToken() {
		if (existsSync(this.tokenPath)) {
			try {
				return JSON.parse(readFileSync(this.tokenPath, 'utf8'));
			} catch (error) {
				console.error(`Exception on load token from ${this.tokenPath}`, error);
			}
		}
		return null;
	}

	saveToken(token = null) {
		if (token) {
			try {
				writeFileSync(this.tokenPath, JSON.stringify(token, null, 2));
			} catch (error) {
				console.error(`Exception on save token to ${this.tokenPath}`, error);
			}
		} else if (existsSync(this.tokenPath)) {
			unlinkSync(this.tokenPath);
		}
	}
}

export class MiAccount {
	constructor(session, username, password, tokenStore = null) {
		this.session = session;
		this.username = username;
		this.password = password;
		this.tokenStore = typeof tokenStore === 'string' ? new MiTokenStore(tokenStore) : tokenStore;
		this.token = tokenStore !== null && this.tokenStore.loadToken();
	}

	async login(sid) {
		if (!this.token) {
			this.token = {deviceId: randomBytes(8).toString('hex').toUpperCase()};
		}
		try {
			let resp = await this._serviceLogin(`serviceLogin?sid=${sid}&_json=true`);
			if (resp.code !== 0) {
				const data = {
					'_json': 'true',
					'qs': resp.qs,
					'sid': resp.sid,
					'_sign': resp._sign,
					'callback': resp.callback,
					'user': this.username,
					'hash': createHash('md5').update(this.password).digest('hex').toUpperCase()
				};
				const formData = new FormData();
				for (const key in data) {
					if (data.hasOwnProperty(key)) {
						formData.append(key, data[key]);
					}
				}
				resp = await this._serviceLogin('serviceLoginAuth2', formData);
				if (resp.code !== 0) {
					throw new Error(resp.desc);
				}
			}

			this.token.userId = resp.userId;
			this.token.passToken = resp.passToken;

			const serviceToken = await this._securityTokenService(resp.location, resp.nonce, resp.ssecurity);
			this.token[sid] = [resp.ssecurity, serviceToken];
			if (this.tokenStore) {
				this.tokenStore.saveToken(this.token);
			}
			return true;
		} catch (e) {
			this.token = null;
			if (this.tokenStore) {
				this.tokenStore.saveToken();
			}
			console.error(`Exception on login ${this.username}:`, e);
			return false;
		}
	}

	async _serviceLogin(uri, data = null) {
		const cookies = {'sdkVersion': '3.9', 'deviceId': this.token.deviceId};
		if (this.token.passToken) {
			cookies.userId = this.token.userId;
			cookies.passToken = this.token.passToken;
		}
		const headers = {
			'User-Agent': 'APP/com.xiaomi.mihome APPV/6.0.103 iosPassportSDK/3.9.0 iOS/14.4 miHSTS',
			'Cookie': Object.keys(cookies).map(key => `${key}=${cookies[key]}`).join('; ')
		};
		const url = `https://account.xiaomi.com/pass/${uri}`;
		const response = await this.session({
			method: data ? 'POST' : 'GET', url,
			headers, cookies, data,
			withCredentials: true
		});
		let resp;
		try {
			resp = JSONbig.parse(response.data.slice(11));
		} catch (e) {
			resp = response.data;
		}
		return resp;
	}

	async _securityTokenService(location, nonce, ssecurity) {
		const nsec = `nonce=${nonce}&${ssecurity}`;
		const clientSign = createHash('sha1').update(nsec).digest().toString('base64');
		const response = await this.session.get(`${location}&clientSign=${encodeURIComponent(clientSign)}`, {
			withCredentials: true
		});
		const serviceToken = response.headers["set-cookie"][0].split(';')[0].split('=')[1];
		if (!serviceToken) {
			throw new Error(await response.data);
		}
		return serviceToken;
	}

	/**
	 * 服务请求
	 *
	 * @param sid {string} - 服务 ID
	 * @param url {string} - URL
	 * @param data {object} - 请求数据
	 * @param headers {object} - 请求头
	 * @param rawReps {boolean} - 返回原始响应
	 * @param relogin {boolean} - 遇到401重新登录
	 * @return {Promise<any>} - 响应数据
	 */
	async miRequest(
		sid, {url, data = null, headers = {}},
		{rawReps = false, relogin = true} = {rawReps: false, relogin: true}
	) {
		let errorMsg = 'Unknown error';
		if ((this.token && this.token[sid]) || await this.login(sid)) {  // Ensure login
			const cookies = {
				'userId': this.token.userId,
				'serviceToken': this.token[sid][1],
				...headers['Cookie'],
				...headers['cookie'],
				...headers['cookies'],
				...headers['Cookies']
			};
			const content = typeof data === 'function' ? data(this.token, cookies) : data;
			const method = data ? 'POST' : 'GET';

			const formData = new FormData();
			for (const key in content) {
				if (content.hasOwnProperty(key)) {
					formData.append(key, content[key]);
				}
			}

			const response = await this.session({
				method, url, headers: {
					...headers,
					'Cookie': Object.keys(cookies).map(key => `${key}=${cookies[key]}`).join('; ')
				},
				data: formData,
				withCredentials: true
			}).catch(e => {
				return e.response ?? {status: -1, data: {code: -1, message: e.message}};
			});
			let {status, data: body} = response;

			const {code, message} = body;

			switch (status) {
				case 200: {
					if (code === 0) {
						return rawReps ? response : body;
					}
					if (message?.toLowerCase().includes('auth')) {
						status = 401; // Unauthorized
					}
					errorMsg = `${code} ${message}`;
					break;
				}
				case 401: {
					if (relogin) {
						console.warn(`Auth error on request ${url}(${code} ${message}), relogin...`);
						this.token = null; // Auth error, reset login
						return await this.miRequest(sid, {url, data, headers}, {rawReps, relogin: false});
					}
					errorMsg = message ?? code ?? status ?? errorMsg;
					break;
				}
				default: {
					errorMsg = `${status} ${message}`;
				}
			}
		} else {
			errorMsg = 'Login failed';
		}
		throw new Error(`MiRequest failed: ${errorMsg} ${url}`);
	}
}
