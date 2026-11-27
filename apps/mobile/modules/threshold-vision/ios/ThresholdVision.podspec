Pod::Spec.new do |s|
  s.name           = 'ThresholdVision'
  s.version        = '0.1.0'
  s.summary        = 'On-device beverage label text recognition using Apple Vision.'
  s.author         = 'Comeback Technologies LLC'
  s.homepage       = 'https://github.com/rmanna80/threshold'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '17.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Vision', 'UIKit'
  s.source_files   = '**/*.{h,m,swift}'
end
