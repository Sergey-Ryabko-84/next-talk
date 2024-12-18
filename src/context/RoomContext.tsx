"use client";

import { useRouter } from "next/navigation";
import React, { createContext, useEffect, useState, useReducer, useContext } from "react";
import Peer, { MediaConnection } from "peerjs";
import { iceServers, ws } from "@/lib";
import {
  peersReducer,
  PeerState,
  addPeerStreamAction,
  addPeerNameAction,
  removePeerStreamAction,
  addAllPeersAction,
} from "../reducers";

import { UserContext } from "./UserContext";
import { IPeer } from "../types/peer";

interface RoomValue {
  stream?: MediaStream;
  screenStream?: MediaStream;
  peers: PeerState;
  shareScreen: () => void;
  roomId: string;
  setRoomId: (id: string) => void;
  screenSharingId: string;
  handleCameraToggle: () => void;
  handleAudioToggle: () => void;
  isCameraOn: boolean;
  isAudioOn: boolean;
}

type Props = {
  children: React.ReactNode;
};

export const RoomContext = createContext<RoomValue>({
  peers: {},
  shareScreen: () => {},
  setRoomId: () => {},
  screenSharingId: "",
  roomId: "",
  handleCameraToggle: () => {},
  handleAudioToggle: () => {},
  isCameraOn: true,
  isAudioOn: true,
});

if (typeof window !== "undefined" && window.Cypress) {
  window.Peer = Peer;
}

export const RoomProvider = ({ children }: Props) => {
  const { push } = useRouter();
  const { userName, userId } = useContext(UserContext);
  const [me, setMe] = useState<Peer | null>(null);
  const [stream, setStream] = useState<MediaStream | undefined>();
  const [screenStream, setScreenStream] = useState<MediaStream | undefined>();
  const [peers, dispatch] = useReducer(peersReducer, {});
  const [screenSharingId, setScreenSharingId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [isCameraOn, setIsCameraOn] = useState<boolean>(true);
  const [isAudioOn, setIsAudioOn] = useState<boolean>(true);

  const getUsers = ({ participants }: { participants: Record<string, IPeer> }) => {
    dispatch(addAllPeersAction(participants));
  };

  const removePeer = (peerId: string) => {
    dispatch(removePeerStreamAction(peerId));
  };

  const switchStream = (newStream: MediaStream) => {
    if (!me) return;

    setScreenSharingId(me.id || "");
    Object.values(me.connections || {}).forEach((connection: MediaConnection[]) => {
      const videoTrack = newStream.getTracks().find((track) => track.kind === "video");
      if (videoTrack) {
        connection[0].peerConnection
          .getSenders()
          .find((sender) => sender.track?.kind === "video")
          ?.replaceTrack(videoTrack)
          .catch((err: Error) => console.error(err));
      }
    });
  };

  const shareScreen = () => {
    if (screenSharingId) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(switchStream);
    } else {
      navigator.mediaDevices.getDisplayMedia({}).then((stream) => {
        switchStream(stream);
        setScreenStream(stream);
      });
    }
  };

  const nameChangedHandler = ({ peerId, userName }: { peerId: string; userName: string }) => {
    dispatch(addPeerNameAction(peerId, userName));
  };

  useEffect(() => {
    ws.emit("change-name", { peerId: userId, userName, roomId });
  }, [userName, userId, roomId]);

  useEffect(() => {
    if (!userId) {
      console.log("Waiting for userId...");
      return;
    }

    const peer = new Peer(userId, {
      host: process.env.NEXT_PUBLIC_PEER_SERVER_HOST,
      port: 443,
      path: "/",
      debug: 3,
      config: { iceServers },
    });

    console.log("peer", peer);

    setMe(peer);

    try {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        setStream(stream);
      });
    } catch (error) {
      console.error(error);
    }

    const enterRoom = ({ roomId }: { roomId: string }) => {
      console.log("room-created");
      push(`/room/${roomId}`);
    };

    ws.on("room-created", enterRoom);
    ws.on("get-users", getUsers);
    ws.on("user-disconnected", removePeer);
    ws.on("user-started-sharing", (peerId) => setScreenSharingId(peerId));
    ws.on("user-stopped-sharing", () => setScreenSharingId(""));
    ws.on("name-changed", nameChangedHandler);

    return () => {
      ws.off("room-created");
      ws.off("get-users");
      ws.off("user-disconnected");
      ws.off("user-started-sharing");
      ws.off("user-stopped-sharing");
      ws.off("user-joined");
      ws.off("name-changed");
      me?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (screenSharingId) {
      ws.emit("start-sharing", { peerId: screenSharingId, roomId });
    } else {
      ws.emit("stop-sharing");
    }
  }, [screenSharingId, roomId]);

  useEffect(() => {
    if (!me) return;
    if (!stream) return;
    ws.on("user-joined", ({ peerId, userName: name }) => {
      const call = me.call(peerId, stream, {
        metadata: {
          userName,
        },
      });
      call.on("stream", (peerStream) => {
        dispatch(addPeerStreamAction(peerId, peerStream));
      });
      dispatch(addPeerNameAction(peerId, name));
    });

    me.on("call", (call) => {
      const { userName } = call.metadata;
      dispatch(addPeerNameAction(call.peer, userName));
      call.answer(stream);
      call.on("stream", (peerStream) => {
        dispatch(addPeerStreamAction(call.peer, peerStream));
      });
    });

    return () => {
      ws.off("user-joined");
    };
  }, [me, stream, userName]);

  function handleCameraToggle() {
    if (stream) {
      const tracks = stream.getVideoTracks();
      tracks.forEach((track) => {
        track.enabled = !track.enabled;
        setIsCameraOn(!isCameraOn);
      });
    }
  }

  function handleAudioToggle() {
    if (stream) {
      const tracks = stream.getAudioTracks();
      tracks.forEach((track) => {
        track.enabled = !track.enabled;
        setIsAudioOn(!isAudioOn);
      });
    }
  }

  return (
    <RoomContext.Provider
      value={{
        stream,
        screenStream,
        peers,
        shareScreen,
        roomId,
        setRoomId,
        screenSharingId,
        handleCameraToggle,
        handleAudioToggle,
        isCameraOn,
        isAudioOn,
      }}>
      {children}
    </RoomContext.Provider>
  );
};
