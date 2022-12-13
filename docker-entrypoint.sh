#!/bin/sh

echo "::group::Installing Lacework CLI components"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component install sca
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component install sast
echo "::endgroup::"
echo "::group::Printing Lacework CLI information"
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" version
lacework --noninteractive -a "${LW_ACCOUNT_NAME}" -k "${LW_API_KEY}" -s "${LW_API_SECRET}" component list
echo "::endgroup::"
node /dist/index.js
