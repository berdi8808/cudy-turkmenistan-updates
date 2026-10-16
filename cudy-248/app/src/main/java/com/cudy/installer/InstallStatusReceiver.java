package com.cudy.installer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

public final class InstallStatusReceiver extends BroadcastReceiver {
 public static final String ACTION_INSTALL_STATUS="com.cudy.installer.UPDATE_STATUS";
 @Override public void onReceive(Context context,Intent intent){
  int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
  if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){
   @SuppressWarnings("deprecation") Intent confirm=intent.getParcelableExtra(Intent.EXTRA_INTENT);
   if(confirm!=null){confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(confirm);}
  }
 }
}
