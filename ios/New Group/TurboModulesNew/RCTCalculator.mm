//
//  RCTCalculator.mm
//  Countdown
//
//  Created by Rohit Garg on 09/08/26.
//

#import "ReactCodegen/RTNCalculatorSpec/RTNCalculatorSpec.h"

@interface RTNCalculator : NSObject <NativeRTNCalculatorSpec>

@end


@implementation RTNCalculator

RCT_EXPORT_MODULE();


- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
    return std::make_shared<facebook::react::NativeRTNCalculatorSpecJSI>(params);
}

- (void)add:(double)a b:(double)b resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject { 
  NSNumber *result = [[NSNumber alloc] initWithInteger:a+b];
  resolve(result);
}

- (void)callMeLater:(nonnull RCTResponseSenderBlock)successCb failureCB:(nonnull RCTResponseSenderBlock)failureCB { 
  successCb(@[@"nene"]);
}

- (void)promisesNumber:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject {
  resolve(@"non empty");
}

- (nonnull NSString *)reverseString:(nonnull NSString *)str {
  // here functionality is missing
  return @"newstr";
}

@end
