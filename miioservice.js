import crypto from 'crypto';
import open from 'open';
import {promisify} from 'util';
import zlib from 'zlib';

// const REGIONS = ['cn', 'de', 'i2', 'ru', 'sg', 'us'];

export class MiIOService {
	constructor(account, region = null) {
		this.account = account;
		this.server = `https://${region && region !== 'cn' ? `${region}.` : ''}api.io.mi.com/app`;
	}

	static async miotDecode(ssecurity, nonce, data, gzip = false) {
		const decipher = crypto.createDecipheriv('rc4', Buffer.from(ssecurity, 'base64'), '');
		let decrypted = decipher.update(Buffer.from(data, 'base64'));
		if (gzip) {
			const gunzip = promisify(zlib.gunzip);
			decrypted = await gunzip(decrypted);
		}
		return JSON.parse(decrypted.toString());
	}

	static signNonce(ssecurity, nonce) {
		const hash = crypto.createHash('sha256');
		hash.update(Buffer.from(ssecurity, 'base64'));
		hash.update(Buffer.from(nonce, 'base64'));
		return hash.digest('base64');
	}

	static signData(uri, data, ssecurity) {
		if (typeof data !== 'string') {
			data = JSON.stringify(data);
		}
		const nonce = crypto.randomBytes(8).toString('base64') + Buffer.from([(Date.now() / 60000) >>> 0]).toString('base64');
		const snonce = this.signNonce(ssecurity, nonce);
		const msg = [uri, snonce, nonce, `data=${data}`].join('&');
		const signature = crypto.createHmac('sha256', Buffer.from(snonce, 'base64')).update(msg).digest('base64');
		return {_nonce: nonce, data, signature};
	}

	async miioRequest(uri, data) {
		const prepareData = (token, cookies) => {
			cookies['PassportDeviceId'] = token['deviceId'];
			return MiIOService.signData(uri, data, token['xiaomiio'][0]);
		};

		const headers = {
			'User-Agent': 'iOS-14.4-6.0.103-iPhone12,3--D7744744F7AF32F0544445285880DD63E47D9BE9-8816080-84A3F44E137B71AE-iPhone',
			'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2'
		};

		const resp = await this.account.miRequest('xiaomiio', {url: this.server + uri, data: prepareData, headers});
		if (!resp.result) {
			throw new Error(`MiIORequest Failed: ${JSON.stringify(resp)} ${uri}`);
		}
		return resp.result;
	}

	async homeRequest(did, method, params) {
		return await this.miioRequest(`/home/rpc/${did}`, {
			id: 1, method: method, "accessKey": "IOS00026747c5acafc2", 'params': params
		});
	}

	async homeGetProps(did, props) {
		return await this.homeRequest(did, 'get_prop', props);
	}

	async homeSetProps(did, props) {
		return Promise.all(props.map(async (i) => await this.homeSetProp(did, i[0], i[1])));
	}

	async homeGetProp(did, prop) {
		const res = await this.homeGetProps(did, [prop]);
		return res[0];
	}

	async homeSetProp(did, prop, value) {
		const result = (await this.homeRequest(did, `set_${prop}`, Array.isArray(value) ? value : [value]))[0];
		return result === 'ok' ? 0 : result;
	}

	async miotRequest(cmd, params) {
		return await this.miioRequest(`/miotspec/${cmd}`, {'params': params});
	}

	async miotGetProps(did, iids) {
		const params = iids.map(i => ({did: did, siid: i[0], piid: i[1]}));
		const result = await this.miotRequest('prop/get', params);
		return result.map(it => it.code === 0 ? it.value : null);
	}

	async miotSetProps(did, props) {
		const params = props.map(i => ({did: did, siid: i[0], piid: i[1], value: i[2]}));
		const result = await this.miotRequest('prop/set', params);
		return result.map(it => it.code !== undefined ? it.code : -1);
	}

	async miotGetProp(did, iid) {
		const res = await this.miotGetProps(did, [iid]);
		return res[0];
	}

	async miotSpec(type = null) {
		if (type) {
			await open(`https://home.miot-spec.com/spec/${type}`);
		}
	}

	async miotSetProp(did, iid, value) {
		return (await this.miotSetProps(did, [[iid[0], iid[1], value]]))[0];
	}

	async miotAction(did, iid, args = []) {
		const result = await this.miotRequest('action', {did: did, siid: iid[0], aiid: iid[1], in: args});
		return 'code' in result ? result.code : -1;
	}

	async deviceList(name = null, getVirtualModel = false, getHuamiDevices = 0) {
		const result = await this.miioRequest('/home/device_list', {getVirtualModel, getHuamiDevices});
		const resultList = result.list;
		return name === 'full' ? resultList : resultList.filter(i => !name || i.name.includes(name)).map(i => ({
			name: i.name, model: i.model, did: i.did, token: i.token
		}));
	}
}
