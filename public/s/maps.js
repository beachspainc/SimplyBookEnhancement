// beachspa-map.js — 完全封装版

import { FileUtils } from './utilities.js';

// 注入配套 CSS（/s/beachspa-map.css）
FileUtils.inject_css(import.meta.url);

// 加载 Google Maps 扩展组件库
const gmapsScript = document.createElement('script');
gmapsScript.type = 'module';
gmapsScript.src = 'https://ajax.googleapis.com/ajax/libs/@googlemaps/extended-component-library/0.6.11/index.min.js';
document.head.appendChild(gmapsScript);

// 地图配置
const CONFIGURATION = {
    locations: [
        {
            title: 'Beach Spa',
            address1: '2720 N Mall Dr',
            address2: 'Virginia Beach, VA, United States',
            coords: { lat: 36.8208595, lng: -76.0717545 },
            placeId: 'ChIJ_SRjmirruokRk1hUFOxJs7s'
        }
    ],
    mapOptions: {
        center: { lat: 36.8208595, lng: -76.0717545 },
        fullscreenControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        zoom: 15,
        zoomControl: true,
        maxZoom: 17,
        mapId: 'abc91a486dbbc98470d4d1ca' // ✅ 替换为你的 Map ID
    },
    mapsApiKey: 'AIzaSyATFlPHcfUf7W5shPQmAlzMNZTz7oDd0J4', // ✅ 替换为你的 API Key
    capabilities: {
        input: false,
        autocomplete: false,
        directions: false,
        distanceMatrix: false,
        details: false,
        actions: false
    }
};

// 注入 DOM 并初始化地图
document.addEventListener('DOMContentLoaded', async () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'beachspa-map-wrapper';

    const locator = document.createElement('gmpx-store-locator');
    locator.id = 'locator';
    locator.setAttribute('map-id', CONFIGURATION.mapOptions.mapId);
    wrapper.appendChild(locator);

    const apiLoader = document.createElement('gmpx-api-loader');
    apiLoader.setAttribute('key', CONFIGURATION.mapsApiKey);
    apiLoader.setAttribute('solution-channel', 'GMP_QB_locatorplus_v11_c');

    document.body.appendChild(apiLoader);
    document.body.appendChild(wrapper);

    await customElements.whenDefined('gmpx-store-locator');
    locator.configureFromQuickBuilder(CONFIGURATION);
});
