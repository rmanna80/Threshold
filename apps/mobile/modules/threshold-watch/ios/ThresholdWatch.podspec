Pod::Spec.new do |s|
  s.name           = 'ThresholdWatch'
  s.version        = '0.1.0'
  s.summary        = 'WatchConnectivity bridge between the Threshold iPhone app and its watchOS companion.'
  s.author         = 'Comeback Technologies LLC'
  s.homepage       = 'https://github.com/rmanna80/threshold'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '17.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'WatchConnectivity'
  s.source_files   = '**/*.{h,m,swift}'
end
