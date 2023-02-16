#!/bin/sh

SCA_VERSION=0.0.16
SAST_VERSION=0.0.30

echo "::group::Installing Lacework CLI components"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component install sca --version "${SCA_VERSION}"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component install sast --version "${SAST_VERSION}"
echo "::endgroup::"
echo "::group::Printing Lacework CLI information"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" version
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component list
echo "::endgroup::"
node /dist/src/index.js
