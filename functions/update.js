const common = require('./common.js');

const inboundLinks = () => {

	//A stub implementation since all of the work is now done clientside.
	return Promise.resolve();

}

const TYPE_MAINTENANCE_MODE = 'maintenance_mode';

//data is expected to have a type
const status = (data) => {
	const typ = data.type || TYPE_MAINTENANCE_MODE;
	if (typ === TYPE_MAINTENANCE_MODE) {
		//NOTE: the correctness of this assumes you also deployed the
		//updateInboundLinks recently after the config was changed. The gulp
		//task does that, but it's technically possible to be out of sync.
		return common.DISABLE_CARD_UPDATE_FUNCTIONS;
	}
	return false;
};

exports.inboundLinks = inboundLinks;
exports.status = status;