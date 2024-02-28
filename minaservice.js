import {randomBytes} from 'crypto';

export class MiNAService {
	constructor(account) {
		this.account = account;
	}

	async minaRequest(uri, data = null) {
		const requestId = 'app_ios_' + randomBytes(15).toString('hex');
		if (data) {
			data.requestId = requestId;
		} else {
			uri += '&requestId=' + requestId;
		}
		const headers = {
			'User-Agent': 'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103'
		};
		return await this.account.miRequest('micoapi', 'https://api2.mina.mi.com' + uri, data, headers);
	}

	async deviceList(master = 0) {
		const result = await this.minaRequest(`/admin/v2/device_list?master=${master}`);
		return result.data || null;
	}

	async ubusRequest(deviceId, method, path, message) {
		const result = await this.minaRequest('/remote/ubus', {
			deviceId,
			message: JSON.stringify(message),
			method,
			path
		});
		return result && result.data;
	}

	async textToSpeech(deviceId, text) {
		return this.ubusRequest(deviceId, 'text_to_speech', 'mibrain', {text});
	}

	async playerSetVolume(deviceId, volume) {
		return this.ubusRequest(deviceId, 'player_set_volume', 'mediaplayer', {volume, media: 'app_ios'});
	}

	async playerPause(deviceId) {
		return this.ubusRequest(deviceId, 'player_play_operation', 'mediaplayer', {action: 'pause', media: 'app_ios'});
	}

	async playerPlay(deviceId) {
		return this.ubusRequest(deviceId, 'player_play_operation', 'mediaplayer', {action: 'play', media: 'app_ios'});
	}

	async playerGetStatus(deviceId) {
		return await this.ubusRequest(deviceId, 'player_get_play_status', 'mediaplayer', {media: 'app_ios'});
	}

	async playerSetLoop(deviceId, type = 1) {
		return this.ubusRequest(deviceId, 'player_set_loop', 'mediaplayer', {media: 'common', type});
	}

	async playByUrl(deviceId, url) {
		return this.ubusRequest(deviceId, 'player_play_url', 'mediaplayer', {url, type: 1, media: 'app_ios'});
	}

	async sendMessage(devices, devno, message, volume = null) {
		let result = false;
		for (let i = 0; i < devices.length; i++) {
			if (devno === -1 || devno !== i + 1 || devices[i].capabilities?.yunduantts) {
				const deviceId = devices[i].deviceID;
				result = volume === null ? true : await this.playerSetVolume(deviceId, volume);
				if (result && message) {
					result = await this.textToSpeech(deviceId, message);
				}
				if (!result) {
					console.error(`Send failed: ${message || volume}`);
				}
				if (devno !== -1 || !result) {
					break;
				}
			}
		}
		return result;
	}
}
