#!/bin/sh

echo "::group::Installing Lacework CLI components"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component install sca --version 0.0.8
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component install sast --version 0.0.25
echo "::endgroup::"
echo "::group::Printing Lacework CLI information"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" version
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component list
echo "::endgroup::"
node /dist/src/index.js
