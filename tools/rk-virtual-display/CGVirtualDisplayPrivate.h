// Private CoreGraphics API for virtual display creation.
// Used by DeskPad, BetterDisplay, and similar tools.
// These symbols are present in CoreGraphics.framework but not in public headers.

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(double)refreshRate;
@property (readonly) NSUInteger width;
@property (readonly) NSUInteger height;
@property (readonly) double refreshRate;
@end

@interface CGVirtualDisplaySettings : NSObject
@property (copy) NSArray<CGVirtualDisplayMode *> *modes;
@property NSUInteger hiDPI;
@end

@interface CGVirtualDisplayDescriptor : NSObject
@property (copy) NSString *name;
@property NSUInteger maxPixelsWide;
@property NSUInteger maxPixelsHigh;
@property CGSize sizeInMillimeters;
@property unsigned int vendorID;
@property unsigned int productID;
@property unsigned int serialNum;
- (void)setDispatchQueue:(dispatch_queue_t)queue;
@property (copy) void (^terminationHandler)(id display, id termination);
@end

@interface CGVirtualDisplay : NSObject
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@property (readonly) CGDirectDisplayID displayID;
@end
