export const PERMISSIONS_UPDATE_PERMISSIONS = 'PERMISSIONS_UPDATE_PERMISSIONS';

export const updatePermissions = (permissions) => {
	return {
		type:PERMISSIONS_UPDATE_PERMISSIONS,
		permissions
	};
};